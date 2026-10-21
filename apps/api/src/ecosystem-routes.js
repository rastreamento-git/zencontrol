const { randomUUID, createHash } = require("node:crypto");
const d = require("./domain"),
  f = require("./finance-engine"),
  cal = require("./financial-calendar");
const { fail, integer } = require("./errors"),
  { transaction } = require("./database");
const portal = require("./portal-service"),
  { notify } = require("./notifications");
const {
  issueActivation,
  createTechnicianAccount,
} = require("./technician-access");
const { StockClient } = require("./stock-client"),
  { createMediaStore } = require("./media-store");
const { settlementPdf } = require("./pdf");
function configureEcosystem(app, pool, cfg, auth) {
  const admin = auth.requireAdmin,
    actor = (req) => req.user.nome || req.user.login;
  const inField = () => require("./field-access").delegated();
  const mine = (req) => portal.technician(pool, req.user.id);
  const central = (req, res, next) => {
    if (req.user.papel === "tecnico") fail(403, "Ação exclusiva da central.");
    next();
  };
  app.get("/api/notifications", async (req, res) => {
    const t =
        req.user.papel === "tecnico" || inField() ? await mine(req) : null,
      limit = Math.min(100, integer(req.query.limit || 30, "Limite")),
      page = integer(req.query.page || 1, "Página");
    const args = [t ? "technician" : "central", t?.id || null, req.user.id];
    const where =
      "n.audience=$1 AND (n.technician_id=$2 OR ($2::int IS NULL AND n.technician_id IS NULL))";
    const items = await d.rows(
      pool,
      `SELECT n.id,n.title,n.detail,n.target,n.created_at,r.read_at FROM zc_notifications n LEFT JOIN zc_notification_reads r ON r.notification_id=n.id AND r.user_id=$3 WHERE ${where} ORDER BY n.created_at DESC,n.id LIMIT $4 OFFSET $5`,
      [...args, limit, (page - 1) * limit],
    );
    const unread = Number(
      (
        await d.one(
          pool,
          `SELECT count(*) n FROM zc_notifications n WHERE ${where} AND NOT EXISTS(SELECT 1 FROM zc_notification_reads r WHERE r.notification_id=n.id AND r.user_id=$3)`,
          args,
        )
      ).n,
    );
    res.json({ items, unread, page, limit });
  });
  app.post("/api/notifications/:id/read", async (req, res) => {
    const t =
      req.user.papel === "tecnico" || inField() ? await mine(req) : null;
    const n = await d.one(pool, "SELECT * FROM zc_notifications WHERE id=$1", [
      req.params.id,
    ]);
    if (
      !n ||
      n.audience !== (t ? "technician" : "central") ||
      n.technician_id !== (t?.id || null)
    )
      fail(404, "Alerta indisponível.");
    await pool.query(
      "INSERT INTO zc_notification_reads(notification_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [n.id, req.user.id],
    );
    if (inField())
      await d.audit(
        pool,
        actor(req),
        "field_notification_read",
        "notification",
        n.id,
      );
    res.json({ ok: true });
  });
  app.post("/api/technicians/:id/activation", admin, async (req, res) => {
    const access = await transaction(pool, async (db) => {
      const t = await d.one(db, "SELECT * FROM zc_technicians WHERE id=$1", [
        integer(req.params.id, "Técnico"),
      ]);
      if (!t?.active) fail(404, "Técnico ativo não encontrado.");
      const u = await d.one(
        db,
        "SELECT u.id,u.login FROM usuarios u JOIN zc_technician_accounts a ON a.user_id=u.id WHERE a.technician_id=$1",
        [t.id],
      );
      if (!u) return createTechnicianAccount(db, t, actor(req));
      await db.query("UPDATE usuarios SET ativo=true WHERE id=$1", [u.id]);
      return {
        login: u.login,
        ...(await issueActivation(db, u.id, actor(req))),
      };
    });
    res.json(access);
  });
  app.post("/api/technician/orders/:id/finish", async (req, res) => {
    const row = await transaction(pool, async (db) => {
      const { order } = await portal.ownOrder(db, req.user.id, req.params.id);
      if (
        order.version !== req.body.version ||
        [
          "CONCLUÍDO",
          "CANCELADO",
          "AGUARDANDO ESTOQUE",
          "AGUARDANDO CONFERÊNCIA",
        ].includes(order.status)
      )
        fail(409, "Serviço indisponível. Atualize a tela.");
      const day = cal.date(req.body.executed_on);
      if (day > d.today()) fail(400, "Execução não pode ter data futura.");
      const notes = d.string(
        req.body.notes || "",
        "Observações do técnico",
        6000,
        true,
      );
      const draft = await d.one(
        db,
        "SELECT id FROM zc_batches WHERE order_id=$1 AND state='draft' AND source='portal'",
        [order.id],
      );
      if (!draft)
        fail(
          409,
          "Inicie o registro no ZenField antes de finalizar a execução.",
        );
      if (order.parent_order_id && require("./equipment-plan").bundled(order))
        fail(409, "Registre a execução na OS principal.");
      await require("./bundled-service").captureGroup(db, order, day);
      await db.query(
        "UPDATE zc_orders SET status='EXECUÇÃO FINALIZADA',executed_on=$2,execution_finished_at=$3,updated_at=$3,version=version+1 WHERE id=$1",
        [order.id, day, d.now()],
      );
      await db.query(
        "UPDATE zc_batches SET order_version=order_version+1,notes=$2,version=version+1 WHERE order_id=$1 AND state='draft'",
        [order.id, notes],
      );
      await d.audit(db, actor(req), "execution_finished", "order", order.id, {
        executed_on: day,
      });
      return { ok: true };
    });
    res.json(row);
  });
  app.post("/api/orders/:id/conference", central, async (req, res) => {
    await transaction(pool, async (db) => {
      const o = await d.one(
        db,
        "SELECT * FROM zc_orders WHERE id=$1 AND deleted_at=''",
        [req.params.id],
      );
      if (
        !o ||
        !["AGUARDANDO CONFERÊNCIA", "AGUARDANDO VALIDAÇÃO"].includes(o.status)
      )
        fail(409, "Serviço indisponível para conferência.");
      await db.query(
        "UPDATE zc_orders SET conference_started_at=$2 WHERE id=$1",
        [o.id, d.now()],
      );
      await d.audit(db, actor(req), "conference_started", "order", o.id);
    });
    res.json({ ok: true });
  });
  app.get("/api/technician/finance", async (req, res) =>
    res.json(await f.summary(pool, (await mine(req)).id)),
  );
  app.get("/api/technician/rates", async (req, res) => {
    const t = await mine(req);
    await transaction(pool, (db) => f.initialRate(db, t));
    res.json({
      items: await d.rows(
        pool,
        "SELECT id,effective_on,prices,created_at FROM zc_rates WHERE technician_id=$1 ORDER BY effective_on DESC",
        [t.id],
      ),
      today: d.today(),
    });
  });
  app.get("/api/technician/requests", async (req, res) =>
    res.json({
      items: await d.rows(
        pool,
        "SELECT * FROM zc_requests WHERE technician_id=$1 ORDER BY created_at DESC LIMIT 200",
        [(await mine(req)).id],
      ),
    }),
  );
  app.post("/api/technician/requests", async (req, res) => {
    const t = await mine(req),
      b = req.body;
    if (!["rate", "dispute", "stock"].includes(b.kind))
      fail(400, "Tipo de solicitação inválido.");
    const reason = d.string(b.reason, "Justificativa", 2000, true),
      key = d.string(b.request_key, "Chave", 160, true);
    if (key.length < 12) fail(400, "Chave muito curta.");
    let proposed = b.proposed || {},
      oid = null;
    if (b.kind === "rate") {
      f.prices(proposed.prices);
      cal.date(proposed.effective_on);
      if (proposed.effective_on < d.today())
        fail(400, "Solicite uma vigência atual ou futura.");
      proposed = {
        prices: proposed.prices,
        effective_on: proposed.effective_on,
      };
    }
    if (b.kind === "dispute") {
      const own = await portal.ownOrder(pool, req.user.id, b.order_id);
      oid = own.order.id;
      const amount = proposed.amount_cents;
      if (
        !Number.isSafeInteger(amount) ||
        Math.abs(amount) > 100000000 ||
        !amount
      )
        fail(400, "Informe o ajuste desejado em centavos.");
      proposed = { amount_cents: amount };
    }
    if (b.kind === "stock") {
      if (
        !["replenishment", "receipt", "return", "transfer"].includes(
          proposed.action,
        )
      )
        fail(400, "Movimento solicitado inválido.");
      const quantity = integer(proposed.quantity || 1, "Quantidade");
      if (quantity > 1000) fail(400, "Limite de 1000 itens.");
      proposed = {
        action: proposed.action,
        quantity,
        model: d.string(proposed.model || "", "Modelo ou categoria", 200),
        serials: d.string(proposed.serials || "", "Seriais", 3000),
        destination: d.string(proposed.destination || "", "Destino", 200),
      };
    }
    const id = await transaction(pool, async (db) => {
      const old = await d.one(
        db,
        "SELECT * FROM zc_requests WHERE request_key=$1",
        [key],
      );
      if (old) {
        const canonical = (x) =>
          Array.isArray(x)
            ? x.map(canonical)
            : x && typeof x === "object"
              ? Object.fromEntries(
                  Object.keys(x)
                    .sort()
                    .map((k) => [k, canonical(x[k])]),
                )
              : x;
        if (
          old.technician_id !== t.id ||
          old.kind !== b.kind ||
          old.order_id !== oid ||
          old.reason !== reason ||
          JSON.stringify(canonical(old.proposed)) !==
            JSON.stringify(canonical(proposed))
        )
          fail(409, "Esta chave pertence a outra solicitação.");
        return old.id;
      }
      const id = randomUUID(),
        history = [
          { action: "created", actor: actor(req), at: d.now(), reason },
        ];
      await db.query(
        "INSERT INTO zc_requests(id,technician_id,kind,order_id,proposed,reason,history,request_key) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8)",
        [
          id,
          t.id,
          b.kind,
          oid,
          JSON.stringify(proposed),
          reason,
          JSON.stringify(history),
          key,
        ],
      );
      await notify(
        db,
        "central",
        null,
        "request:" + id,
        "Nova solicitação do técnico",
        { request_id: id, kind: b.kind, technician: t.name },
        "requests",
      );
      await d.audit(db, actor(req), "request_created", "request", id, {
        kind: b.kind,
      });
      return id;
    });
    res.status(201).json({ id });
  });
  app.get("/api/requests", admin, async (req, res) =>
    res.json({
      items: await d.rows(
        pool,
        "SELECT r.*,t.name technician_name FROM zc_requests r JOIN zc_technicians t ON t.id=r.technician_id WHERE ($1='' OR r.state=$1) ORDER BY r.created_at DESC LIMIT 200",
        [String(req.query.state || "")],
      ),
    }),
  );
  app.post("/api/requests/:id/decision", admin, async (req, res) =>
    res.json(await decide(req, false)),
  );
  app.post("/api/technician/requests/:id/respond", async (req, res) =>
    res.json(await decide(req, true)),
  );
  async function decide(req, technical) {
    const t = technical ? await mine(req) : null;
    return transaction(pool, async (db) => {
      const r = await d.one(
        db,
        "SELECT * FROM zc_requests WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!r || (technical && r.technician_id !== t.id))
        fail(404, "Solicitação indisponível.");
      if (r.version !== req.body.version)
        fail(409, "Solicitação alterada. Atualize a tela.");
      const action = req.body.action,
        reason = d.string(req.body.reason || "", "Resposta", 2000, true);
      let state = r.state,
        proposal = r.proposed,
        counter = r.counterproposal;
      if (technical) {
        if (action === "accept" && r.state === "counteroffer") {
          proposal = counter;
          await f.addRate(db, r.technician_id, proposal, actor(req));
          state = "approved";
        } else if (action === "decline" && r.state === "counteroffer")
          state = "rejected";
        else if (action === "resubmit" && r.state === "information_requested")
          state = "pending";
        else fail(409, "Resposta indisponível para esta situação.");
      } else {
        if (!["pending", "information_requested"].includes(r.state))
          fail(409, "Solicitação já decidida ou aguardando o técnico.");
        if (action === "approve") {
          if (r.kind === "rate")
            await f.addRate(db, r.technician_id, proposal, actor(req));
          if (r.kind === "dispute") {
            const l = await d.one(
              db,
              "SELECT * FROM zc_financial_ledger WHERE order_id=$1 AND technician_id=$2",
              [r.order_id, r.technician_id],
            );
            if (!l) fail(409, "OS ainda sem composição financeira.");
            const order = await require("./orders").get(db, r.order_id);
            if (order.tracker_waiver_authorized)
              fail(
                409,
                "OS com dispensa de rastreador não gera remuneração nem ajustes.",
              );
            await db.query(
              "INSERT INTO zc_adjustments(id,order_id,amount_cents,reason,created_by,request_id) VALUES($1,$2,$3,$4,$5,$6)",
              [
                randomUUID(),
                r.order_id,
                proposal.amount_cents,
                reason,
                actor(req),
                r.id,
              ],
            );
          }
          // Stock requests authorize a human-operated movement in Estoque Pro; no direct inventory write.
          state = "approved";
        } else if (action === "reject") state = "rejected";
        else if (action === "information") state = "information_requested";
        else if (action === "counteroffer" && r.kind === "rate") {
          f.prices(req.body.proposed?.prices);
          cal.date(req.body.proposed.effective_on);
          if (req.body.proposed.effective_on < d.today())
            fail(400, "Vigência anterior à autorização.");
          counter = req.body.proposed;
          state = "counteroffer";
        } else fail(400, "Decisão inválida.");
      }
      const history = [
        ...r.history,
        {
          action,
          actor: actor(req),
          at: d.now(),
          reason,
          proposal: action === "counteroffer" ? counter : undefined,
        },
      ];
      await db.query(
        "UPDATE zc_requests SET state=$2,counterproposal=$3::jsonb,history=$4::jsonb,version=version+1,updated_at=now() WHERE id=$1",
        [r.id, state, JSON.stringify(counter), JSON.stringify(history)],
      );
      await d.audit(db, actor(req), "request_" + action, "request", r.id, {
        state,
        reason,
      });
      await notify(
        db,
        technical ? "central" : "technician",
        technical ? null : r.technician_id,
        "request:" + r.id + ":" + (r.version + 1),
        "Solicitação atualizada",
        { request_id: r.id, state, reason },
        technical ? "requests" : r.kind === "stock" ? "stock" : "rates",
      );
      return { ok: true, state };
    });
  }
  app.get("/api/finance-v2/technicians/:id", admin, async (req, res) =>
    res.json(await f.summary(pool, integer(req.params.id, "Técnico"))),
  );
  app.get("/api/finance-v2/technicians/:id/rates", admin, async (req, res) =>
    res.json({
      items: await d.rows(
        pool,
        "SELECT * FROM zc_rates WHERE technician_id=$1 ORDER BY effective_on DESC",
        [integer(req.params.id, "Técnico")],
      ),
    }),
  );
  app.post("/api/finance-v2/technicians/:id/rates", admin, async (req, res) =>
    res.status(201).json({
      id: await transaction(pool, (db) =>
        f.addRate(db, integer(req.params.id, "Técnico"), req.body, actor(req)),
      ),
    }),
  );
  app.put("/api/finance-v2/technicians/:id/policy", admin, async (req, res) => {
    const tid = integer(req.params.id, "Técnico"),
      policy = cal.validatePolicy(req.body.policy);
    cal.period(policy, d.today());
    await transaction(pool, async (db) => {
      const old = await d.one(
        db,
        "SELECT * FROM zc_closing_policies WHERE technician_id=$1",
        [tid],
      );
      if ((old?.version || 0) !== req.body.version)
        fail(409, "Política alterada. Atualize a tela.");
      await db.query(
        "INSERT INTO zc_closing_policies(technician_id,policy,updated_by) VALUES($1,$2::jsonb,$3) ON CONFLICT(technician_id) DO UPDATE SET policy=EXCLUDED.policy,version=zc_closing_policies.version+1,updated_by=EXCLUDED.updated_by,updated_at=now()",
        [tid, JSON.stringify(policy), actor(req)],
      );
      await d.audit(db, actor(req), "closing_policy_saved", "technician", tid, {
        policy,
      });
    });
    res.json({ ok: true });
  });
  app.get("/api/finance-v2/holidays", admin, async (req, res) =>
    res.json({
      items: await d.rows(pool, "SELECT * FROM zc_holidays ORDER BY day"),
    }),
  );
  app.put("/api/finance-v2/holidays/:day", admin, async (req, res) => {
    const day = cal.date(req.params.day),
      name = d.string(req.body.name, "Feriado", 200, true);
    await transaction(pool, async (db) => {
      await db.query(
        "INSERT INTO zc_holidays(day,name) VALUES($1,$2) ON CONFLICT(day) DO UPDATE SET name=EXCLUDED.name",
        [day, name],
      );
      await d.audit(db, actor(req), "holiday_registered", "holiday", day, {
        name,
      });
    });
    res.json({ ok: true });
  });
  app.get("/api/finance-v2/preview", admin, async (req, res) => {
    const p = await f.preview(
      pool,
      integer(req.query.technician_id, "Técnico"),
      req.query.start,
      req.query.end,
    );
    res.json({ ...p, preview_hash: f.digest(p) });
  });
  app.post("/api/finance-v2/closings", admin, async (req, res) =>
    res
      .status(201)
      .json(
        await transaction(pool, (db) =>
          f.createClosing(db, req.body, actor(req)),
        ),
      ),
  );
  app.post("/api/finance-v2/closings/:id/approve", admin, async (req, res) =>
    res.json(
      await transaction(pool, (db) =>
        f.approveClosing(db, req.params.id, actor(req)),
      ),
    ),
  );
  app.post("/api/finance-v2/closings/:id/payments", admin, async (req, res) => {
    let receipt = {};
    if (req.body.receipt) {
      const { PDFDocument } = require("pdf-lib"),
        sharp = require("sharp");
      const match =
        typeof req.body.receipt === "string" &&
        req.body.receipt.match(
          /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/,
        );
      if (!match) fail(400, "Comprovante: envie PDF ou imagem.");
      let bytes = Buffer.from(match[2], "base64");
      if (bytes.length > 4 * 1024 * 1024)
        fail(400, "Comprovante: limite de 4 MB.");
      let mime = match[1];
      try {
        if (mime === "application/pdf") {
          const pdf = await PDFDocument.load(bytes);
          if (pdf.getPageCount() > 20) fail(400, "Limite de 20 páginas.");
          if (
            pdf.catalog.has(require("pdf-lib").PDFName.of("OpenAction")) ||
            pdf.catalog.has(require("pdf-lib").PDFName.of("Names"))
          )
            fail(400, "PDF ativo não permitido.");
        } else {
          bytes = await sharp(bytes, { limitInputPixels: 24000000 })
            .rotate()
            .resize({
              width: 2000,
              height: 2000,
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg()
            .toBuffer();
          mime = "image/jpeg";
        }
      } catch {
        fail(400, "Comprovante inválido.");
      }
      const sha = createHash("sha256").update(bytes).digest("hex");
      receipt = {
        path: sha + (mime === "application/pdf" ? ".pdf" : ".jpg"),
        mime,
        sha,
      };
      await createMediaStore(cfg).put(receipt.path, bytes);
    }
    res
      .status(201)
      .json(
        await transaction(pool, (db) =>
          f.payment(db, req.params.id, req.body, actor(req), receipt),
        ),
      );
  });
  async function visibleClosing(req) {
    if (!["admin", "operador", "tecnico"].includes(req.user.papel))
      fail(403, "Demonstrativo financeiro restrito.");
    const s = await d.one(pool, "SELECT * FROM zc_settlements WHERE id=$1", [
      req.params.id,
    ]);
    if (
      !s ||
      ((req.user.papel === "tecnico" || inField()) &&
        s.technician_id !== (await mine(req)).id)
    )
      fail(404, "Fechamento indisponível.");
    return s;
  }
  app.get("/api/finance-v2/closings/:id/pdf", async (req, res) => {
    const s = await visibleClosing(req);
    res
      .type("pdf")
      .attachment("Fechamento-" + s.id + ".pdf")
      .send(await settlementPdf(s.snapshot));
  });
  app.get("/api/finance-v2/closings/:id/export", async (req, res) => {
    const s = await visibleClosing(req);
    res.attachment("Fechamento-" + s.id + ".json").json({
      id: s.id,
      state: s.state,
      due_on: s.due_on,
      snapshot: s.snapshot,
    });
  });
  app.get("/api/payments/:id/receipt", async (req, res) => {
    if (!["admin", "operador", "tecnico"].includes(req.user.papel))
      fail(403, "Comprovante restrito.");
    const p = await d.one(
      pool,
      "SELECT p.*,s.technician_id FROM zc_payments p JOIN zc_settlements s ON s.id=p.settlement_id WHERE p.id=$1",
      [req.params.id],
    );
    if (
      !p?.receipt_path ||
      ((req.user.papel === "tecnico" || inField()) &&
        p.technician_id !== (await mine(req)).id)
    )
      fail(404, "Comprovante indisponível.");
    res
      .type(p.receipt_mime)
      .attachment(
        "Comprovante." + (p.receipt_mime === "application/pdf" ? "pdf" : "jpg"),
      )
      .send(await createMediaStore(cfg).read(p.receipt_path));
  });
  app.get("/api/technician/stock/history", async (req, res) => {
    const t = await mine(req);
    if (!t.stock_technician_id) return res.json({ items: [], linked: false });
    const page = integer(req.query.page || 1, "Página"),
      history = await new StockClient(cfg).history(t.stock_technician_id, page);
    await transaction(pool, async (db) => {
      for (const e of history.items)
        if (e.tipo === "CARGA_TECNICO")
          await notify(
            db,
            "technician",
            t.id,
            "stock-event:" + t.stock_technician_id + ":" + e.id,
            "Equipamento recebido na sua carga",
            { serial: e.codigo_serial, model: e.modelo, date: e.data },
            "stock",
          );
    });
    res.json({ ...history, linked: true });
  });
  app.get("/api/finance-v2/reconcile", admin, async (req, res) =>
    res.json({
      invalid_closings: await d.rows(
        pool,
        "SELECT s.id,s.total_cents,COALESCE(sum(p.amount_cents),0)::int paid_cents FROM zc_settlements s LEFT JOIN zc_payments p ON p.settlement_id=s.id GROUP BY s.id HAVING COALESCE(sum(p.amount_cents),0)>s.total_cents",
      ),
      missing_ledgers: await d.rows(
        pool,
        "SELECT id FROM zc_orders WHERE tracker_waiver_authorized=false AND workflow_mode='controlled' AND status='CONCLUÍDO' AND technician_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM zc_financial_ledger l WHERE l.order_id=zc_orders.id) AND NOT EXISTS(SELECT 1 FROM zc_settlement_orders s WHERE s.order_id=zc_orders.id)",
      ),
      unresolved_stock: await d.rows(
        pool,
        "SELECT id,order_id,state,attempts,last_error FROM zc_jobs WHERE kind='stock_installation' AND state<>'done' ORDER BY created_at LIMIT 100",
      ),
    }),
  );
}
module.exports = { configureEcosystem };
