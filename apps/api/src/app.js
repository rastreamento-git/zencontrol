const express = require("express"),
  cors = require("cors"),
  helmet = require("helmet");
const { randomUUID, createHash } = require("node:crypto");
const path = require("node:path");
const { createMediaStore } = require("./media-store");
const sharp = require("sharp");
const { configureAuth, hashPassword, username, publicUser } = require("./auth");
const { transaction } = require("./database");
const { fail, HttpError, integer } = require("./errors");
const { configuration } = require("./config");
const d = require("./domain"),
  o = require("./orders");
const { configureWebhook } = require("./webhook");
const { WPPClient, SGAClient, IntegrationError } = require("./integrations");
const { orderPdf, settlementPdf } = require("./pdf");
const { configurePortal } = require("./portal-routes");
const portal = require("./portal-service");
const { documentOrder } = require("./order-document-load");
const {
  groupedPage,
  presentOrders,
  orderHistory,
} = require("./order-presentation");
function createApp(pool, env = process.env) {
  const cfg = configuration(env),
    app = express();
  app.disable("x-powered-by");
  const origins = (
    cfg.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173"
  )
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (origins.includes("*"))
    throw Error("CORS_ORIGINS exige origens explícitas.");
  origins.push(new URL(cfg.PUBLIC_URL).origin);
  if (cfg.TECHNICIAN_PORTAL_URL)
    origins.push(new URL(cfg.TECHNICIAN_PORTAL_URL).origin);
  if (cfg.TRUST_PROXY)
    app.set("trust proxy", integer(cfg.TRUST_PROXY, "TRUST_PROXY"));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          imgSrc: ["'self'", "data:", "blob:"],
          scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
          workerSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(
    cors({
      origin(origin, cb) {
        cb(
          origin && !origins.includes(origin)
            ? new HttpError(403, "Origem não permitida.")
            : null,
          true,
        );
      },
    }),
  );
  app.use("/api/technician/batches", express.json({ limit: "12mb" }));
  app.use("/api/technician/requests", express.json({ limit: "6mb" }));
  app.use("/api/evidence", express.json({ limit: "24mb" }));
  app.use("/api/finance-v2/closings", express.json({ limit: "6mb" }));
  app.use(express.json({ limit: "512kb" }));
  app.get("/healthz", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({
        status: "ok",
        version: "6.4.0",
        media_storage: cfg.MEDIA_STORAGE || "local",
      });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  configureWebhook(app, pool, cfg);
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      req.body ??= {};
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
        fail(400, "Informe um objeto JSON válido.");
    }
    next();
  });
  const auth = configureAuth(app, cfg, pool);
  app.locals.ready = async () => {
    await createMediaStore(cfg).ready();
    await auth.ready();
  };
  app.locals.config = cfg;
  require("./field-access").configureFieldAccess(app, pool);
  require("./operational-routes").configureOperational(app, pool, auth);
  require("./ecosystem-routes").configureEcosystem(app, pool, cfg, auth);
  configurePortal(app, pool, cfg, auth);
  const admin = auth.requireAdmin;
  const actor = (req) => req.user.nome || req.user.login;
  const page = (req) => ({
    page: integer(req.query.page || 1, "Página"),
    limit: Math.min(100, integer(req.query.limit || 25, "Limite")),
  });
  app.get("/api/meta", (req, res) =>
    res.json({
      statuses: d.statuses,
      services: d.services,
      today: d.today(),
      version: "6.4.0",
    }),
  );
  app.get("/api/overview", async (req, res) => {
    const today = d.today();
    const totals = await d.one(
      pool,
      "SELECT count(*)::int total,count(*) FILTER(WHERE substring(scheduled_at,1,10)=$1)::int today,count(*) FILTER(WHERE scheduled_at<>'' AND substring(scheduled_at,1,10)<$1 AND status NOT IN ('CONCLUÍDO','CANCELADO'))::int overdue FROM zc_orders WHERE deleted_at='' AND parent_order_id IS NULL",
      [today],
    );
    const status = await d.rows(
      pool,
      "SELECT status,count(*)::int n FROM zc_orders WHERE deleted_at='' AND parent_order_id IS NULL GROUP BY status",
    );
    const technicians = await d.rows(
      pool,
      "SELECT t.id,t.name,count(o.id)::int open_orders FROM zc_technicians t LEFT JOIN zc_orders o ON o.technician_id=t.id AND o.deleted_at='' AND o.parent_order_id IS NULL AND o.status NOT IN ('CONCLUÍDO','CANCELADO') WHERE t.active=true GROUP BY t.id ORDER BY open_orders DESC,t.name LIMIT 8",
    );
    res.json({
      totals,
      statuses: Object.fromEntries(status.map((s) => [s.status, s.n])),
      technicians,
      activity: await d.rows(
        pool,
        "SELECT id,created_at,actor,action,entity_id FROM zc_audit ORDER BY id DESC LIMIT 8",
      ),
      validations: Number(
        (
          await d.one(
            pool,
            "SELECT count(*) n FROM zc_batches WHERE source<>'bundle' AND state IN ('needs_review','ready','submitted','stock_failed')",
          )
        ).n,
      ),
    });
  });
  app.get("/api/orders", async (req, res) => {
    const p = page(req),
      conditions = [],
      args = [];
    const where = (s, v) => {
      args.push(v);
      conditions.push(s.replaceAll("?", String(args.length)));
    };
    for (const key of ["status", "archive", "technician_id"])
      if (req.query[key]) where(key + "=$?", req.query[key]);
    if (req.query.q) {
      args.push("%" + String(req.query.q).slice(0, 200) + "%");
      conditions.push(
        `(id ILIKE $${args.length} OR vehicle ILIKE $${args.length} OR customer_name ILIKE $${args.length} OR technician_name ILIKE $${args.length} OR EXISTS(SELECT 1 FROM zc_batches b WHERE b.order_id=eligible.id AND b.source='portal' AND b.submitted_at<>'' AND b.imeis::text ILIKE $${args.length}))`,
      );
    }
    if (req.query.day) {
      if (!d.date(req.query.day)) fail(400, "Data inválida.");
      where("substring(scheduled_at,1,10)=$?", req.query.day);
    }
    if (req.query.overdue === "1")
      where(
        "scheduled_at<>'' AND substring(scheduled_at,1,10)<$? AND status NOT IN ('CONCLUÍDO','CANCELADO')",
        d.today(),
      );
    const clause = conditions.join(" AND ");
    const result = await groupedPage(pool, {
      base: "deleted_at=''",
      conditions: clause,
      args,
      ...p,
      sort: req.query.day ? "scheduled_at,id" : "updated_at DESC,id DESC",
    });
    res.json({ ...result, items: await presentOrders(pool, result.items) });
  });
  app.post("/api/orders", async (req, res) =>
    res
      .status(201)
      .json(d.publicOrder(await o.create(pool, req.body, actor(req)))),
  );
  app.get("/api/orders/:id", async (req, res) => {
    const [order] = await presentOrders(pool, [
      await o.get(pool, req.params.id),
    ]);
    Object.assign(order, await orderHistory(pool, order));
    order.jobs = await d.rows(
      pool,
      "SELECT id,kind,state,last_error,created_at FROM zc_jobs WHERE order_id=$1 ORDER BY created_at DESC LIMIT 20",
      [order.id],
    );
    order.extras = ["admin", "operador"].includes(req.user.papel)
      ? await d.rows(pool, "SELECT * FROM zc_order_extras WHERE order_id=$1", [
          order.id,
        ])
      : [];
    order.submissions = await d.rows(
      pool,
      "SELECT id,state,version,submitted_at FROM zc_batches WHERE order_id=$1 ORDER BY created_at DESC",
      [order.id],
    );
    res.json(order);
  });
  app.patch("/api/orders/:id", async (req, res) =>
    res.json(
      d.publicOrder(await o.edit(pool, req.params.id, req.body, actor(req))),
    ),
  );
  app.post("/api/orders/:id/complete", async (req, res) => {
    const result = await transaction(pool, async (db) => {
      const order = await o.get(db, req.params.id);
      if (req.body.version !== order.version)
        fail(409, "A OS mudou. Atualize antes de concluir.");
      return o.complete(db, order.id, actor(req), req.body.reason, cfg);
    });
    res.json(d.publicOrder(result));
  });
  app.post("/api/orders/:id/reopen", admin, async (req, res) => {
    await transaction(pool, async (db) => {
      const order = await o.get(db, req.params.id);
      await o.guard(db, order.id);
      if (req.body.version !== order.version) fail(409, "A OS mudou.");
      if (
        await d.one(
          db,
          "SELECT 1 FROM zc_settlement_orders WHERE order_id=$1",
          [order.id],
        )
      )
        fail(409, "OS incluída em fechamento financeiro.");
      if (order.workflow_mode === "controlled" && order.stock_receipt)
        fail(
          409,
          "Esta OS já movimentou estoque. Use o estorno do Estoque Pro e uma nova OS para outro serviço.",
        );
      const reason = d.string(req.body.reason, "Motivo", 1000, true);
      if (reason.length < 5) fail(400, "Descreva o motivo.");
      await o.update(
        db,
        "zc_orders",
        "id",
        order.id,
        {
          status: "PENDENTE",
          completed_at: "",
          closed_by: "",
          updated_at: d.now(),
        },
        true,
      );
      await db.query(
        "UPDATE zc_financial_ledger SET state='awaiting_approval',eligible_on='' WHERE order_id=$1",
        [order.id],
      );
      await require("./notifications").orderEvent(
        db,
        { ...order, version: order.version + 1 },
        "updated",
        { reason },
      );
      await d.audit(db, actor(req), "reopened", "order", order.id, { reason });
    });
    res.json({ ok: true });
  });
  app.delete("/api/orders/:id", admin, async (req, res) => {
    await transaction(pool, async (db) => {
      const order = await o.get(db, req.params.id);
      if (order.parent_order_id && order.document_data?.equipment_counts)
        fail(409, "Arquive o atendimento pela OS principal.");
      await o.guard(db, order.id);
      if (req.body.version !== order.version) fail(409, "A OS mudou.");
      if (
        await d.one(
          db,
          "SELECT 1 FROM zc_settlement_orders WHERE order_id=$1 OR order_id IN (SELECT id FROM zc_orders WHERE parent_order_id=$1)",
          [order.id],
        )
      )
        fail(409, "OS incluída em fechamento financeiro.");
      const reason = d.string(req.body.reason, "Motivo", 1000, true);
      if (reason.length < 5) fail(400, "Descreva o motivo.");
      await o.update(
        db,
        "zc_orders",
        "id",
        order.id,
        { deleted_at: d.now() },
        true,
      );
      if (order.document_data?.equipment_counts)
        await db.query(
          "UPDATE zc_orders SET deleted_at=$2,status='CANCELADO',updated_at=$2,version=version+1 WHERE parent_order_id=$1 AND deleted_at=''",
          [order.id, d.now()],
        );
      await db.query(
        "UPDATE zc_financial_ledger SET state='cancelled' WHERE order_id=$1 OR order_id IN (SELECT id FROM zc_orders WHERE parent_order_id=$1)",
        [order.id],
      );
      await require("./notifications").orderEvent(
        db,
        { ...order, version: order.version + 1 },
        "cancelled",
        { reason },
      );
      await d.audit(db, actor(req), "deleted", "order", order.id, { reason });
    });
    res.json({ ok: true });
  });
  app.post("/api/orders/:id/dispatch", async (req, res) => {
    if (
      req.body.masked === false &&
      !["admin", "operador"].includes(req.user.papel)
    )
      fail(403, "A versão integral da OS exige administrador.");
    if (
      req.body.masked === false &&
      !["admin", "operador"].includes(req.user.papel)
    )
      fail(403, "Envio integral exige administração.");
    res.status(202).json({
      job_id: await o.dispatch(pool, req.params.id, req.body, actor(req), cfg),
    });
  });
  app.get("/api/orders/:id/pdf", async (req, res) => {
    const order = await documentOrder(pool, await o.get(pool, req.params.id));
    res
      .type("pdf")
      .attachment(order.id + ".pdf")
      .send(
        await orderPdf(
          order,
          req.query.integral !== "1" ||
            !["admin", "operador"].includes(req.user.papel),
          { portalUrl: cfg.TECHNICIAN_PORTAL_URL || cfg.PUBLIC_URL },
        ),
      );
  });
  app.get("/api/technicians", async (req, res) => {
    const list = await d.rows(
      pool,
      "SELECT * FROM zc_technicians ORDER BY active DESC,name",
    );
    for (const t of list) {
      delete t.extra_info;
      if (!["admin", "operador"].includes(req.user.papel))
        for (const k of [
          "price_install",
          "price_maintenance",
          "price_removal",
          "price_visit",
        ])
          delete t[k];
    }
    res.json({ items: list });
  });
  const saveTech = async (req, res) => {
    const data = {};
    for (const [key, max] of Object.entries({
      name: 200,
      phone: 40,
      address: 500,
      tags: 500,
      receive_group: 100,
      receive_group_name: 200,
      send_group: 100,
      send_group_name: 200,
    }))
      if (req.body[key] !== undefined)
        data[key] = d.string(req.body[key], key, max, key === "name");
    if (req.body.stock_technician_id !== undefined)
      data.stock_technician_id =
        req.body.stock_technician_id === null ||
        req.body.stock_technician_id === ""
          ? null
          : integer(req.body.stock_technician_id, "Técnico no Estoque Pro");
    for (const k of [
      "price_install",
      "price_maintenance",
      "price_removal",
      "price_visit",
    ])
      if (req.body[k] !== undefined) data[k] = d.money(req.body[k]);
    if (data.phone) {
      data.phone = data.phone.replace(/\D/g, "");
      if (data.phone.length < 10 || data.phone.length > 15)
        fail(400, "Telefone inválido. Inclua DDI e DDD.");
    }
    for (const k of ["send_group", "receive_group"])
      if (data[k] && !/^[0-9-]+@g\.us$/.test(data[k]))
        fail(400, "JID de grupo inválido.");
    if (req.body.active !== undefined)
      data.active = d.boolean(req.body.active, "Ativo");
    let access;
    const tech = await transaction(pool, async (db) => {
      let row,
        rateChanged = false;
      if (req.params.id) {
        const old = await d.one(
          db,
          "SELECT * FROM zc_technicians WHERE id=$1",
          [req.params.id],
        );
        if (!old) fail(404, "Técnico não encontrado.");
        if (req.body.version !== old.version)
          fail(409, "Cadastro alterado por outra pessoa.");
        if (!Object.keys(data).length)
          fail(400, "Nenhuma alteração informada.");
        if (
          data.stock_technician_id !== undefined &&
          data.stock_technician_id !== old.stock_technician_id &&
          (await d.one(
            db,
            "SELECT 1 FROM zc_batches WHERE technician_id=$1 AND state='approved_sync'",
            [old.id],
          ))
        )
          fail(
            409,
            "Aguarde a confirmação do estoque antes de alterar o vínculo.",
          );
        rateChanged = [
          "price_install",
          "price_maintenance",
          "price_removal",
          "price_visit",
        ].some((k) => data[k] !== undefined && data[k] !== old[k]);
        row = await o.update(db, "zc_technicians", "id", old.id, data, true);
        if (data.name && data.name !== old.name)
          await db.query(
            "UPDATE zc_orders SET technician_name=$1,version=version+1 WHERE technician_id=$2",
            [data.name, old.id],
          );
      } else {
        if (!data.name) fail(400, "Informe o nome.");
        row = await o.insert(db, "zc_technicians", data);
      }
      if (!req.params.id) {
        access = await require("./technician-access").createTechnicianAccount(
          db,
          row,
          actor(req),
        );
        await require("./finance-engine").initialRate(db, row, actor(req));
      }
      if (data.active !== undefined)
        await db.query(
          "UPDATE usuarios SET ativo=$1,versao_sessao=versao_sessao+1 WHERE id IN (SELECT user_id FROM zc_technician_accounts WHERE technician_id=$2)",
          [row.active, row.id],
        );
      if (req.params.id && rateChanged) {
        await require("./finance-engine").addRate(
          db,
          row.id,
          {
            effective_on: d.today(),
            prices: {
              Instalação: row.price_install,
              Reinstalação: row.price_install,
              Manutenção: row.price_maintenance,
              Retirada: row.price_removal,
              Visita: row.price_visit,
              Improdutiva: row.price_visit,
            },
          },
          actor(req),
        );
      }
      await d.audit(db, actor(req), "saved", "technician", row.id);
      return row;
    });
    res.json({ id: tech.id, access });
  };
  app.post("/api/technicians", admin, saveTech);
  app.patch("/api/technicians/:id", admin, saveTech);
  app.get("/api/volunteers", async (req, res) => {
    const p = page(req),
      q = "%" + String(req.query.q || "").slice(0, 200) + "%";
    res.json({
      items: await d.rows(
        pool,
        "SELECT * FROM zc_volunteers WHERE name ILIKE $1 OR sga_code ILIKE $1 ORDER BY name LIMIT $2 OFFSET $3",
        [q, p.limit, (p.page - 1) * p.limit],
      ),
      total: Number(
        (
          await d.one(
            pool,
            "SELECT count(*) n FROM zc_volunteers WHERE name ILIKE $1 OR sga_code ILIKE $1",
            [q],
          )
        ).n,
      ),
      ...p,
    });
  });
  app.post("/api/volunteers", async (req, res) => {
    const v = await transaction(pool, async (db) => {
      const row = await o.insert(db, "zc_volunteers", {
        name: d.string(req.body.name, "Nome", 200, true),
        sga_code: d.string(req.body.sga_code || "", "Código SGA", 50),
      });
      await d.audit(db, actor(req), "created", "volunteer", row.id);
      return row;
    });
    res.status(201).json({ id: v.id });
  });
  app.delete("/api/volunteers/:id", admin, async (req, res) => {
    await transaction(pool, async (db) => {
      await db.query("DELETE FROM zc_volunteers WHERE id=$1", [req.params.id]);
      await db.query(
        "UPDATE zc_financial_ledger SET state='cancelled' WHERE order_id=$1",
        [order.id],
      );
      await require("./notifications").orderEvent(
        db,
        { ...order, version: order.version + 1 },
        "cancelled",
        { reason },
      );
      await d.audit(db, actor(req), "deleted", "volunteer", req.params.id);
    });
    res.json({ ok: true });
  });
  app.get("/api/users", admin, async (req, res) =>
    res.json({
      items: (
        await d.rows(
          pool,
          "SELECT u.*,a.technician_id FROM usuarios u LEFT JOIN zc_technician_accounts a ON a.user_id=u.id ORDER BY u.nome,u.id",
        )
      ).map((u) => ({ ...publicUser(u), technician_id: u.technician_id })),
    }),
  );
  const saveUser = async (req, res) => {
    const body = req.body;
    const login = username(body.login),
      name = d.string(body.nome, "Nome", 200, true),
      role = body.papel || "operador";
    if (!["admin", "operador", "tecnico"].includes(role))
      fail(400, "Perfil inválido.");
    const active =
      body.ativo === undefined ? true : d.boolean(body.ativo, "Ativo");
    const hash = body.password ? await hashPassword(body.password) : null;
    const user = await transaction(pool, async (db) => {
      let row;
      if (req.params.id) {
        const old = await d.one(
          db,
          "SELECT * FROM usuarios WHERE id=$1 FOR UPDATE",
          [req.params.id],
        );
        if (!old) fail(404, "Usuário não encontrado.");
        if (
          old.id === req.user.id &&
          (!active || (old.papel === "admin" && role !== "admin"))
        )
          fail(409, "Você não pode desativar a própria conta administrativa.");
        if (
          old.ativo &&
          old.papel === "admin" &&
          (!active || role !== "admin") &&
          Number(
            (
              await d.one(
                db,
                "SELECT count(*) n FROM usuarios WHERE papel='admin' AND ativo=true",
              )
            ).n,
          ) <= 1
        )
          fail(409, "Mantenha um administrador ativo.");
        row = await d.one(
          db,
          "UPDATE usuarios SET nome=$1,login=$2,papel=$3,ativo=$4,senha_hash=COALESCE($5,senha_hash),versao_sessao=versao_sessao+1 WHERE id=$6 RETURNING *",
          [name, login, role, active, hash, old.id],
        );
      } else {
        if (!hash) fail(400, "Defina a senha inicial.");
        row = await d.one(
          db,
          "INSERT INTO usuarios(nome,login,papel,senha_hash,ativo) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [name, login, role, hash, active],
        );
      }
      if (role === "tecnico") {
        const tid = integer(body.technician_id, "Técnico");
        if (
          !(await d.one(
            db,
            "SELECT 1 FROM zc_technicians WHERE id=$1 AND active=true",
            [tid],
          ))
        )
          fail(400, "Vincule um técnico ativo à conta.");
        await db.query(
          "INSERT INTO zc_technician_accounts(user_id,technician_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET technician_id=EXCLUDED.technician_id",
          [row.id, tid],
        );
      } else
        await db.query("DELETE FROM zc_technician_accounts WHERE user_id=$1", [
          row.id,
        ]);
      await d.audit(db, actor(req), "saved", "user", row.id, {
        papel: role,
        ativo: active,
      });
      return publicUser(row);
    });
    res.json(user);
  };
  app.post("/api/users", admin, saveUser);
  app.patch("/api/users/:id", admin, saveUser);
  app.post("/api/auth/password", async (req, res) => {
    const { checkPassword } = require("./auth");
    const row = await d.one(
      pool,
      "SELECT senha_hash FROM usuarios WHERE id=$1",
      [req.user.id],
    );
    if (!(await checkPassword(req.body.current_password, row?.senha_hash)))
      fail(403, "Senha atual incorreta.");
    const hash = await hashPassword(req.body.new_password);
    await transaction(pool, async (db) => {
      await db.query(
        "UPDATE usuarios SET senha_hash=$1,versao_sessao=versao_sessao+1 WHERE id=$2",
        [hash, req.user.id],
      );
      await d.audit(db, actor(req), "password_changed", "user", req.user.id);
    });
    res.json({ ok: true });
  });
  app.get("/api/batches", async (req, res) =>
    res.json({
      items: await d.rows(
        pool,
        "SELECT b.*,t.name technician_name,(SELECT count(*)::int FROM zc_evidence e WHERE e.batch_id=b.id AND e.state='ready') ready_count FROM zc_batches b JOIN zc_technicians t ON t.id=b.technician_id WHERE b.source<>'bundle' ORDER BY b.created_at DESC LIMIT 100",
      ),
    }),
  );
  app.get("/api/batches/:id", async (req, res) => {
    const batch = await d.one(pool, "SELECT * FROM zc_batches WHERE id=$1", [
      req.params.id,
    ]);
    if (!batch) fail(404, "Lote não encontrado.");
    batch.files = await d.rows(
      pool,
      "SELECT id,state,mime,sha256,kind,serial_code,equipment_type,equipment_model FROM zc_evidence WHERE batch_id=$1",
      [batch.id],
    );
    const currentOrder = batch.order_id
      ? await o.get(pool, batch.order_id)
      : null;
    batch.rule = currentOrder
      ? await portal.rule(pool, currentOrder.service, currentOrder)
      : null;
    batch.required_equipment = currentOrder
      ? portal.requiredEquipment(currentOrder)
      : {};
    batch.current_order = currentOrder ? d.publicOrder(currentOrder) : null;
    res.json(batch);
  });
  app.get("/api/evidence/:id", async (req, res) => {
    const item = await d.one(
      pool,
      "SELECT * FROM zc_evidence WHERE id=$1 AND state='ready'",
      [req.params.id],
    );
    if (!item || !/^[-a-f0-9]+\.(?:jpg|pdf)$/.test(item.path))
      fail(404, "Foto indisponível.");
    res
      .set("Cache-Control", "no-store")
      .type(item.mime)
      .set(
        "Content-Disposition",
        item.mime === "application/pdf"
          ? 'attachment; filename="checklist-assinado.pdf"'
          : "inline",
      )
      .send(await createMediaStore(cfg).read(item.path));
  });
  app.post("/api/evidence/:id/edit", async (req, res) => {
    if (
      typeof req.body.image !== "string" ||
      req.body.image.length > 16 * 1024 * 1024
    )
      fail(400, "Imagem inválida ou muito grande.");
    let bytes;
    try {
      bytes = await sharp(
        Buffer.from(req.body.image.split(",").at(-1), "base64"),
        { limitInputPixels: 40000000 },
      )
        .rotate()
        .jpeg({ quality: 94 })
        .toBuffer();
    } catch {
      fail(400, "Imagem inválida.");
    }
    await transaction(pool, async (db) => {
      const item = await d.one(db, "SELECT * FROM zc_evidence WHERE id=$1", [
        req.params.id,
      ]);
      if (!item || item.state !== "ready") fail(404, "Foto não encontrada.");
      if (req.body.sha256 !== item.sha256)
        fail(409, "Foto alterada por outra pessoa.");
      const b = await d.one(db, "SELECT * FROM zc_batches WHERE id=$1", [
        item.batch_id,
      ]);
      if (b.source === "portal")
        fail(
          409,
          "As fotos enviadas pelo portal são preservadas. Solicite correção ao técnico.",
        );
      if (
        ["approved", "completed", "approved_sync", "stock_failed"].includes(
          b.state,
        )
      )
        fail(409, "Lote já aprovado.");
      if (
        await d.one(
          db,
          "SELECT 1 FROM zc_jobs WHERE idempotency_key=$1 AND state IN ('pending','running')",
          ["batch:" + b.id],
        )
      )
        fail(409, "Aguarde o download.");
      const name = randomUUID() + ".jpg";
      await createMediaStore(cfg).put(name, bytes);
      await db.query(
        "UPDATE zc_evidence SET path=$1,original_path=$2,sha256=$3 WHERE id=$4",
        [
          name,
          item.original_path || item.path,
          createHash("sha256").update(bytes).digest("hex"),
          item.id,
        ],
      );
      await db.query("UPDATE zc_batches SET version=version+1 WHERE id=$1", [
        b.id,
      ]);
      await d.audit(db, actor(req), "photo_edited", "batch", b.id, {
        evidence_id: item.id,
      });
    });
    res.json({ ok: true });
  });
  app.post("/api/batches/:id/review", async (req, res) => {
    const existingBatch = await portal.batch(pool, req.params.id);
    if (
      existingBatch.source === "portal" ||
      (existingBatch.order_id &&
        (await o.get(pool, existingBatch.order_id)).workflow_mode ===
          "controlled")
    )
      return res.json(
        await portal.approve(
          pool,
          cfg,
          existingBatch.id,
          {
            ...req.body,
            serials:
              req.body.imeis === undefined
                ? undefined
                : String(req.body.imeis)
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
          },
          actor(req),
        ),
      );
    await transaction(pool, async (db) => {
      const b = await d.one(db, "SELECT * FROM zc_batches WHERE id=$1", [
        req.params.id,
      ]);
      if (!b) fail(404, "Lote indisponível.");
      if (["approved", "completed"].includes(b.state))
        fail(409, "Lote já revisado.");
      const order = await o.get(db, req.body.order_id || b.order_id);
      if (
        order.technician_id !== b.technician_id ||
        !b.vehicle ||
        ![d.vehicle(order.vehicle), d.vehicle(order.chassis)].includes(
          d.vehicle(b.vehicle),
        )
      )
        fail(400, "O técnico e o veículo precisam corresponder à OS.");
      const count = Number(
        (
          await d.one(
            db,
            "SELECT count(*) n FROM zc_evidence WHERE batch_id=$1 AND state='ready'",
            [b.id],
          )
        ).n,
      );
      if (!count || count !== b.expected_count)
        fail(400, "Baixe todas as fotos antes de aprovar.");
      const reason = d.string(req.body.reason, "Conferência", 1000, true);
      if (reason.length < 5) fail(400, "Descreva a conferência.");
      const close =
        req.body.complete === undefined
          ? false
          : d.boolean(req.body.complete, "Concluir");
      const imei = d.string(req.body.imeis || "", "IMEIs", 500);
      if (imei) {
        const codes = imei
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        if (codes.some((v) => !/^\d{15}$/.test(v)))
          fail(400, "IMEIs devem conter 15 números separados por vírgula.");
        await o.update(
          db,
          "zc_orders",
          "id",
          order.id,
          { imei: [...new Set(codes)].join(", "), updated_at: d.now() },
          true,
        );
      }
      await db.query(
        "UPDATE zc_batches SET state=$1,order_id=$2,reviewed_by=$3,reason=$4 WHERE id=$5",
        [close ? "completed" : "approved", order.id, actor(req), reason, b.id],
      );
      if (close) await o.complete(db, order.id, actor(req), reason, cfg, b.id);
      await d.audit(db, actor(req), "approved", "batch", b.id, {
        order_id: order.id,
        complete: close,
      });
    });
    res.json({ ok: true });
  });
  app.post("/api/batches/:id/redownload", async (req, res) => {
    await transaction(pool, async (db) => {
      const b = await d.one(db, "SELECT * FROM zc_batches WHERE id=$1", [
        req.params.id,
      ]);
      if (b?.source === "portal")
        fail(409, "Fotos do portal não usam download pelo WhatsApp.");
      if (!b?.expected_count) fail(400, "Lote sem fotos.");
      if (["approved", "completed"].includes(b.state))
        fail(409, "Lote já aprovado.");
      const j = await d.one(
        db,
        "SELECT * FROM zc_jobs WHERE idempotency_key=$1",
        ["batch:" + b.id],
      );
      if (j?.state === "running") fail(409, "Download em execução.");
      await db.query(
        "UPDATE zc_evidence SET state='pending' WHERE batch_id=$1",
        [b.id],
      );
      await db.query("UPDATE zc_batches SET state='downloading' WHERE id=$1", [
        b.id,
      ]);
      if (j)
        await db.query(
          "UPDATE zc_jobs SET state='pending',attempts=0,available_at=0,last_error='' WHERE id=$1",
          [j.id],
        );
      else
        await o.enqueue(
          db,
          "download_evidence",
          b.order_id,
          { batch_id: b.id },
          "batch:" + b.id,
        );
      await d.audit(db, actor(req), "redownload_requested", "batch", b.id);
    });
    res.status(202).json({ ok: true });
  });
  app.post("/api/batches/:id/upload", async (req, res) => {
    if (!cfg.INTEGRATIONS_ENABLED) fail(409, "Integrações desativadas.");
    const job = await transaction(pool, async (db) => {
      const b = await d.one(db, "SELECT * FROM zc_batches WHERE id=$1", [
        req.params.id,
      ]);
      if (!b || !["approved", "completed"].includes(b.state))
        fail(400, "Aprove o lote antes do envio.");
      if (b.sga_uploaded_at) fail(409, "Fotos já enviadas.");
      const id = await o.enqueue(
        db,
        "upload_evidence",
        b.order_id,
        { batch_id: b.id },
        "upload:" + b.id,
      );
      await d.audit(db, actor(req), "sga_upload_queued", "batch", b.id, {
        job_id: id,
      });
      return id;
    });
    res.status(202).json({ job_id: job });
  });
  app.get("/api/jobs", async (req, res) =>
    res.json({
      items: await d.rows(
        pool,
        "SELECT id,kind,order_id,state,attempts,created_at,finished_at,last_error FROM zc_jobs ORDER BY created_at DESC LIMIT 100",
      ),
    }),
  );
  app.post("/api/jobs/:id/retry", admin, async (req, res) => {
    await transaction(pool, async (db) => {
      const j = await d.one(db, "SELECT * FROM zc_jobs WHERE id=$1", [
        req.params.id,
      ]);
      if (!j || !["failed", "uncertain"].includes(j.state))
        fail(409, "Tarefa indisponível para nova tentativa.");
      if (j.state === "uncertain" && req.body.confirmed_no_effect !== true)
        fail(400, "Confira no serviço externo que a operação não ocorreu.");
      if (j.kind === "stock_installation") {
        const b = await d.one(db, "SELECT * FROM zc_batches WHERE id=$1", [
          j.payload.batch_id,
        ]);
        if (!b || !["stock_failed", "approved_sync"].includes(b.state))
          fail(409, "Envio substituído ou encerrado.");
        await db.query(
          "UPDATE zc_batches SET state='approved_sync',version=version+1 WHERE id=$1",
          [b.id],
        );
        await db.query(
          "UPDATE zc_orders SET stock_sync_state='pending' WHERE id=$1",
          [j.order_id],
        );
      }
      await db.query(
        "UPDATE zc_jobs SET state='pending',attempts=0,available_at=0,last_error='' WHERE id=$1",
        [j.id],
      );
      await d.audit(db, actor(req), "retry_confirmed", "job", j.id);
    });
    res.json({ ok: true });
  });
  app.post("/api/orders/:id/extras", admin, async (req, res) => {
    const x = await transaction(pool, async (db) => {
      const order = await o.get(db, req.params.id);
      if (
        await d.one(
          db,
          "SELECT 1 FROM zc_settlement_orders WHERE order_id=$1",
          [order.id],
        )
      )
        fail(409, "Fechamento já registrado.");
      if (
        await d.one(db, "SELECT 1 FROM zc_financial_ledger WHERE order_id=$1", [
          order.id,
        ])
      )
        fail(
          409,
          "Composição financeira já registrada. Use um ajuste auditado.",
        );
      const extra = await o.insert(db, "zc_order_extras", {
        order_id: order.id,
        type: d.string(req.body.type || "Extra", "Tipo", 100, true),
        description: d.string(req.body.description || "", "Descrição", 1000),
        amount_cents: d.money(req.body.amount),
      });
      await d.audit(db, actor(req), "extra_added", "order", order.id, {
        id: extra.id,
        amount_cents: extra.amount_cents,
      });
      return extra;
    });
    res.status(201).json(x);
  });
  app.delete("/api/extras/:id", admin, async (req, res) => {
    await transaction(pool, async (db) => {
      const x = await d.one(db, "SELECT * FROM zc_order_extras WHERE id=$1", [
        req.params.id,
      ]);
      if (!x) fail(404, "Adicional não encontrado.");
      if (
        await d.one(
          db,
          "SELECT 1 FROM zc_settlement_orders WHERE order_id=$1",
          [x.order_id],
        )
      )
        fail(409, "Fechamento já registrado.");
      if (
        await d.one(db, "SELECT 1 FROM zc_financial_ledger WHERE order_id=$1", [
          x.order_id,
        ])
      )
        fail(
          409,
          "Composição financeira já registrada. Use um ajuste auditado.",
        );
      await db.query("DELETE FROM zc_order_extras WHERE id=$1", [x.id]);
      await d.audit(db, actor(req), "extra_deleted", "order", x.order_id, {
        id: x.id,
      });
    });
    res.json({ ok: true });
  });
  app.get("/api/finance/preview", admin, async (req, res) =>
    res.json(
      await o.financial(
        pool,
        req.query.technician_id,
        req.query.start,
        req.query.end,
      ),
    ),
  );
  app.post("/api/finance/settlements", admin, async (req, res) => {
    const id = await transaction(pool, async (db) => {
      const p = await o.financial(
        db,
        req.body.technician_id,
        req.body.start,
        req.body.end,
      );
      if (!p.orders.length) fail(400, "Nenhuma OS elegível.");
      if (
        (
          await db.query(
            "SELECT 1 FROM zc_orders WHERE id=ANY($1::text[]) AND workflow_mode='controlled' LIMIT 1",
            [p.orders.map((x) => x.id)],
          )
        ).rowCount
      )
        fail(
          409,
          "OS do portal exige o módulo Financeiro 6.4 com conferência de fechamento.",
        );
      if (
        p.total_cents !== req.body.expected_total ||
        JSON.stringify(p.orders.map((x) => x.id)) !==
          JSON.stringify(req.body.order_ids)
      )
        fail(409, "O cálculo mudou. Gere outra prévia.");
      const id = randomUUID();
      await o.insert(db, "zc_settlements", {
        id,
        technician_id: p.technician.id,
        start_date: p.start,
        end_date: p.end,
        total_cents: p.total_cents,
        snapshot: JSON.stringify(p),
        created_at: d.now(),
        created_by: actor(req),
      });
      for (const order of p.orders)
        await db.query(
          "INSERT INTO zc_settlement_orders(order_id,settlement_id) VALUES($1,$2)",
          [order.id, id],
        );
      await d.audit(db, actor(req), "settled", "settlement", id, {
        total_cents: p.total_cents,
      });
      return id;
    });
    res.status(201).json({ id });
  });
  app.get("/api/finance/settlements", admin, async (req, res) =>
    res.json({
      items: await d.rows(
        pool,
        "SELECT s.id,s.start_date,s.end_date,s.total_cents,s.created_at,s.created_by,t.name technician_name FROM zc_settlements s JOIN zc_technicians t ON t.id=s.technician_id ORDER BY s.created_at DESC LIMIT 100",
      ),
    }),
  );
  app.get("/api/finance/settlements/:id/pdf", admin, async (req, res) => {
    const s = await d.one(
      pool,
      "SELECT snapshot FROM zc_settlements WHERE id=$1",
      [req.params.id],
    );
    if (!s) fail(404, "Fechamento não encontrado.");
    res
      .type("pdf")
      .attachment("Fechamento-" + req.params.id + ".pdf")
      .send(await settlementPdf(s.snapshot));
  });
  app.get("/api/audit", admin, async (req, res) => {
    const p = page(req);
    res.json({
      items: await d.rows(
        pool,
        "SELECT * FROM zc_audit ORDER BY id DESC LIMIT $1 OFFSET $2",
        [p.limit, (p.page - 1) * p.limit],
      ),
      total: Number((await d.one(pool, "SELECT count(*) n FROM zc_audit")).n),
      ...p,
    });
  });
  app.get("/api/settings", admin, async (req, res) => {
    const state = { ...app.locals.wpp };
    if (Date.now() - (state.received_at || 0) > 120000) delete state.qr;
    res.json({
      integrations_enabled: cfg.INTEGRATIONS_ENABLED,
      auto_close_enabled: cfg.AUTO_CLOSE_ENABLED,
      sga_sync_enabled: cfg.SGA_SYNC_ENABLED,
      stock_enabled: cfg.STOCK_ENABLED,
      stock_configured: !!(cfg.STOCK_API_URL && cfg.STOCK_API_SECRET),
      portal_requires_central_approval: true,
      wpp_configured: !!cfg.WPP_API_TOKEN,
      sga_configured: [
        cfg.HINOVA_TOKEN_ASSOC,
        cfg.HINOVA_USER,
        cfg.HINOVA_PASS,
      ].every(Boolean),
      wpp_state: state,
      pending_jobs: Number(
        (
          await d.one(
            pool,
            "SELECT count(*) n FROM zc_jobs WHERE state IN ('pending','running','uncertain')",
          )
        ).n,
      ),
      migrations: await d.rows(
        pool,
        "SELECT summary,created_at FROM zc_migration_runs ORDER BY created_at DESC LIMIT 5",
      ),
    });
  });
  app.get("/api/wpp/status", admin, async (req, res) =>
    res.json({ result: await new WPPClient(cfg).request("status-session") }),
  );
  app.get("/api/wpp/groups", admin, async (req, res) =>
    res.json({ items: await new WPPClient(cfg).groups() }),
  );
  app.post("/api/wpp/start", admin, async (req, res) =>
    res.json({
      result: await new WPPClient(cfg).request(
        "start-session",
        {
          webhook:
            cfg.PUBLIC_URL +
            "/webhook?token=" +
            encodeURIComponent(cfg.ZEN_WEBHOOK_SECRET),
          waitQrCode: false,
        },
        true,
      ),
    }),
  );
  app.post("/api/sga/lookup", async (req, res) =>
    res.json(
      await new SGAClient(cfg).lookup({
        term: req.body.term,
        sga_id: req.body.sga_id,
        chassis: req.body.chassis,
      }),
    ),
  );
  app.post("/api/archive-month", admin, async (req, res) => {
    const month = req.body.month;
    if (
      typeof month !== "string" ||
      !/^\d{4}-\d{2}$/.test(month) ||
      !d.date(month + "-01") ||
      month > d.today().slice(0, 7)
    )
      fail(400, "Mês inválido.");
    const dry =
      req.body.dry_run === undefined
        ? true
        : d.boolean(req.body.dry_run, "Simulação");
    const result = await transaction(pool, async (db) => {
      const list = await d.rows(
        db,
        "SELECT * FROM zc_orders WHERE deleted_at=''",
      );
      const changes = [];
      for (const order of list) {
        let target = "HOT";
        if (["CONCLUÍDO", "CANCELADO"].includes(order.status)) {
          const dates = [d.date(order.completed_at), d.date(order.created_date)]
            .filter(Boolean)
            .sort();
          if (!dates.length) continue;
          const last = dates.at(-1),
            age =
              (Number(month.slice(0, 4)) - Number(last.slice(0, 4))) * 12 +
              Number(month.slice(5, 7)) -
              Number(last.slice(5, 7));
          target = age >= 4 ? "COLD" : age >= 1 ? "WARM" : "HOT";
        }
        if (target !== order.archive) {
          changes.push({ id: order.id, from: order.archive, to: target });
          if (!dry)
            await o.update(
              db,
              "zc_orders",
              "id",
              order.id,
              { archive: target },
              true,
            );
        }
      }
      if (!dry)
        await d.audit(db, actor(req), "archive_month", "system", month, {
          count: changes.length,
        });
      return { month, count: changes.length, dry_run: dry, changes };
    });
    res.json(result);
  });
  app.get("/api/export/orders.csv", admin, async (req, res) => {
    const rows = await d.rows(
        pool,
        "SELECT * FROM zc_orders WHERE deleted_at='' ORDER BY created_date,id",
      ),
      cols = [
        "id",
        "created_date",
        "service",
        "vehicle",
        "customer_name",
        "contact",
        "technician_name",
        "status",
        "scheduled_at",
        "completed_at",
        "archive",
        "notes",
      ];
    const cell = (v) => {
      let s = String(v ?? "");
      if (/^[=+@-]/.test(s.trimStart())) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    res
      .type("text/csv; charset=utf-8")
      .attachment("ZenControl-ordens.csv")
      .send(
        "\ufeff" +
          [cols, ...rows.map((r) => cols.map((c) => r[c]))]
            .map((row) => row.map(cell).join(";"))
            .join("\r\n"),
      );
  });
  app.get("/api/backup", admin, async (req, res) => {
    const { database, manifest, files, cleanup } =
      await require("./backup").prepareBackup(pool, cfg);
    res.once("close", () => {
      cleanup().catch(() => {});
    });
    const archive = require("archiver")("zip", { zlib: { level: 6 } });
    archive.on("error", (e) => res.destroy(e));
    res.attachment("ZenControl-backup-" + d.today() + ".zip").type("zip");
    archive.pipe(res);
    archive.append(database, { name: "database.json" });
    archive.append(manifest, { name: "manifest.json" });
    for (const file of files) archive.file(file.local, { name: file.name });
    try {
      await archive.finalize();
    } finally {
      await cleanup();
    }
  });
  app.post("/api/sql", (req, res) =>
    fail(410, "Endpoint SQL removido. Use as APIs específicas."),
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Rota não encontrada." }),
  );
  app.get("/tecnico", (req, res) => {
    if (cfg.TECHNICIAN_PORTAL_URL)
      return res.redirect(302, cfg.TECHNICIAN_PORTAL_URL);
    res
      .status(503)
      .type("text")
      .send(
        "O Portal do Técnico é um aplicativo separado. Peça à central o endereço de acesso.",
      );
  });
  app.use(express.static(path.join(cfg.ROOT, "apps/web/dist")));
  app.get("/{*splat}", (req, res) =>
    res.sendFile(path.join(cfg.ROOT, "apps/web/dist/index.html")),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof IntegrationError)
      return res.status(502).json({ error: error.message });
    const code =
      error.status ||
      (error.code === "23505"
        ? 409
        : error.code === "22P02"
          ? 400
          : error.code === "23503"
            ? 409
            : 500);
    if (code >= 500)
      console.error(
        JSON.stringify({
          event: "api_error",
          method: req.method,
          code: error.code || error.name,
        }),
      );
    res.status(code).json({
      error:
        code >= 500
          ? "Não foi possível concluir a operação. Consulte os logs locais."
          : error.status
            ? error.message
            : code === 409
              ? "Registro duplicado ou com vínculos que impedem a alteração."
              : "Dados inválidos.",
    });
  });
  return app;
}
module.exports = { createApp };
