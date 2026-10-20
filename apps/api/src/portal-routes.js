const { createMediaStore } = require("./media-store");
const { transaction } = require("./database");
const { fail, integer, serials } = require("./errors");
const d = require("./domain"),
  o = require("./orders"),
  portal = require("./portal-service");
const { StockClient } = require("./stock-client");
const { orderDocument } = require("./order-document");
const { orderPdf } = require("./pdf");
const safeBatch = (b) =>
  Object.fromEntries(
    [
      "id",
      "order_id",
      "state",
      "version",
      "order_version",
      "vehicle",
      "notes",
      "imeis",
      "expected_count",
      "capture_version",
      "checklist_signed",
      "executed_on",
      "submitted_at",
      "reviewed_at",
      "reviewed_by",
      "rejection_reason",
      "reason",
    ].map((k) => [k, b[k]]),
  );
async function files(db, id) {
  return d.rows(
    db,
    "SELECT id,state,mime,sha256,kind,serial_code,equipment_type,equipment_model FROM zc_evidence WHERE batch_id=$1 ORDER BY id",
    [id],
  );
}
function configurePortal(app, pool, cfg, auth) {
  const prefix = "/api/technician";
  app.use(prefix, (req, res, next) => {
    if (!["tecnico", "admin", "operador"].includes(req.user.papel))
      fail(403, "Esta área exige uma conta de técnico.");
    next();
  });
  app.get(prefix + "/me", async (req, res) => {
    const t = await portal.technician(pool, req.user.id);
    res.json({
      id: t.id,
      name: t.name,
      stock_linked: !!t.stock_technician_id,
      user: req.user,
    });
  });
  app.get(prefix + "/orders", async (req, res) => {
    const t = await portal.technician(pool, req.user.id),
      limit = Math.min(100, integer(req.query.limit || 50, "Limite")),
      page = integer(req.query.page || 1, "Página");
    const args = [t.id],
      parts = [
        "technician_id=$1",
        "deleted_at=''",
        "workflow_mode='controlled'",
      ];
    for (const [field, column] of [
      ["q", "id"],
      ["vehicle", "vehicle"],
      ["service", "service"],
      ["status", "status"],
    ])
      if (req.query[field]) {
        args.push("%" + String(req.query[field]).slice(0, 200) + "%");
        parts.push(`${column} ILIKE $${args.length}`);
      }
    for (const [field, op] of [
      ["from", ">="],
      ["to", "<="],
    ])
      if (req.query[field]) {
        const day = require("./financial-calendar").date(req.query[field]);
        args.push(day);
        parts.push(
          `substring(COALESCE(NULLIF(executed_on,''),scheduled_at),1,10) ${op} $${args.length}`,
        );
      }
    if (req.query.view === "open")
      parts.push("status NOT IN ('CONCLUÍDO','CANCELADO')");
    if (req.query.view === "closed")
      parts.push("status IN ('CONCLUÍDO','CANCELADO')");
    const where = parts.join(" AND "),
      total = Number(
        (
          await d.one(
            pool,
            "SELECT count(*) n FROM zc_orders WHERE " + where,
            args,
          )
        ).n,
      );
    const list = await d.rows(
      pool,
      `SELECT * FROM zc_orders WHERE ${where} ORDER BY CASE WHEN status IN ('CONCLUÍDO','CANCELADO') THEN 1 ELSE 0 END,scheduled_at,id LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, limit, (page - 1) * limit],
    );
    res.json({ items: list.map(portal.publicOrder), total, page, limit });
  });
  app.get(prefix + "/orders/:id", async (req, res) => {
    const { order } = await portal.ownOrder(pool, req.user.id, req.params.id);
    const history = await d.rows(
      pool,
      "SELECT id,state,version,order_version,vehicle,notes,imeis,expected_count,submitted_at,reviewed_at,reviewed_by,rejection_reason,reason,capture_version,checklist_signed,executed_on FROM zc_batches WHERE order_id=$1 AND source='portal' ORDER BY created_at DESC",
      [order.id],
    );
    for (const b of history) b.files = await files(pool, b.id);
    res.json({
      order: portal.publicOrder(order),
      document: orderDocument(order, true, {
        portalUrl: cfg.TECHNICIAN_PORTAL_URL || cfg.PUBLIC_URL,
      }),
      required_equipment: portal.requiredEquipment(order),
      rule: await portal.rule(pool, order.service, order),
      submissions: history,
    });
  });
  app.get(prefix + "/orders/:id/pdf", async (req, res) => {
    const { order } = await portal.ownOrder(pool, req.user.id, req.params.id);
    res
      .type("pdf")
      .attachment(order.id + ".pdf")
      .send(
        await orderPdf(order, true, {
          portalUrl: cfg.TECHNICIAN_PORTAL_URL || cfg.PUBLIC_URL,
        }),
      );
  });
  app.get(prefix + "/stock", async (req, res) => {
    const t = await portal.technician(pool, req.user.id);
    if (!t.stock_technician_id) return res.json({ items: [], linked: false });
    const load = await new StockClient(cfg).items(t.stock_technician_id);
    const associations = await d.rows(
      pool,
      "SELECT b.order_id,b.state,b.imeis FROM zc_batches b WHERE b.technician_id=$1 AND b.state IN ('draft','submitted','approved_sync','stock_failed')",
      [t.id],
    );
    res.json({
      ...load,
      linked: true,
      items: load.items.map((item) => {
        const refs = associations.filter((b) =>
          b.imeis.includes(item.codigo_serial),
        );
        return {
          ...item,
          orders: refs.map((b) => b.order_id),
          availability: refs.some((b) => b.state !== "draft")
            ? "Pendente de conferência"
            : refs.length
              ? "Reservado na OS"
              : "Disponível",
        };
      }),
    });
  });
  app.post(prefix + "/orders/:id/draft", async (req, res) =>
    res
      .status(201)
      .json(
        safeBatch(
          await portal.startDraft(
            pool,
            req.user.id,
            req.params.id,
            req.body.version,
          ),
        ),
      ),
  );
  app.post(prefix + "/batches/:id/photos", async (req, res) =>
    res
      .status(201)
      .json(
        await portal.upload(pool, cfg, req.user.id, req.params.id, req.body),
      ),
  );
  app.patch(prefix + "/batches/:id", async (req, res) => {
    await transaction(pool, async (db) => {
      const { b, order } = await portal.ownBatch(
        db,
        req.user.id,
        req.params.id,
      );
      if (
        b.state !== "draft" ||
        b.version !== req.body.version ||
        order.version !== b.order_version
      )
        fail(409, "Rascunho alterado ou indisponível. Atualize a tela.");
      const codes = req.body.serials?.length ? serials(req.body.serials) : [];
      if (codes.length > 20)
        fail(400, "Limite de 20 equipamentos por serviço.");
      await o.update(
        db,
        "zc_batches",
        "id",
        b.id,
        {
          imeis: JSON.stringify(codes),
          checklist_signed: req.body.checklist_signed === true,
          notes: d.string(req.body.notes || "", "Relato do serviço", 6000),
          executed_on: req.body.executed_on
            ? require("./financial-calendar").date(req.body.executed_on)
            : b.executed_on,
        },
        true,
      );
      await d.audit(
        db,
        String(req.user.id),
        "portal_draft_updated",
        "batch",
        b.id,
      );
    });
    res.json({ ok: true });
  });
  app.post(prefix + "/batches/:id/submit", async (req, res) =>
    res.json(await portal.submit(pool, req.user.id, req.params.id, req.body)),
  );
  app.post(prefix + "/batches/:id/discard", async (req, res) => {
    await transaction(pool, async (db) => {
      const { b } = await portal.ownBatch(db, req.user.id, req.params.id);
      if (b.state !== "draft" || b.version !== req.body.version)
        fail(409, "Rascunho indisponível.");
      await o.update(
        db,
        "zc_batches",
        "id",
        b.id,
        { state: "withdrawn" },
        true,
      );
      await d.audit(
        db,
        String(req.user.id),
        "portal_draft_discarded",
        "batch",
        b.id,
      );
    });
    res.json({ ok: true });
  });
  app.patch(prefix + "/photos/:id", async (req, res) => {
    await transaction(pool, async (db) => {
      const item = await d.one(db, "SELECT * FROM zc_evidence WHERE id=$1", [
        req.params.id,
      ]);
      if (!item) fail(404, "Foto indisponível.");
      const { b, order } = await portal.ownBatch(
        db,
        req.user.id,
        item.batch_id,
      );
      if (
        b.state !== "draft" ||
        b.version !== req.body.version ||
        order.version !== b.order_version
      )
        fail(409, "Envio alterado ou já encaminhado para conferência.");
      if (b.capture_version >= 2)
        fail(
          409,
          "O código é identificado pela foto. Remova a foto incorreta e envie outra.",
        );
      const code = d.string(req.body.serial_code || "", "IMEI/serial", 128);
      await db.query("UPDATE zc_evidence SET serial_code=$1 WHERE id=$2", [
        code,
        item.id,
      ]);
      await d.audit(
        db,
        String(req.user.id),
        "portal_photo_identification_changed",
        "batch",
        b.id,
        { evidence_id: item.id },
      );
      await db.query("UPDATE zc_batches SET version=version+1 WHERE id=$1", [
        b.id,
      ]);
    });
    res.json({ ok: true });
  });
  app.delete(prefix + "/photos/:id", async (req, res) => {
    await transaction(pool, async (db) => {
      const item = await d.one(db, "SELECT * FROM zc_evidence WHERE id=$1", [
        req.params.id,
      ]);
      if (!item) fail(404, "Foto indisponível.");
      const { b, order } = await portal.ownBatch(
        db,
        req.user.id,
        item.batch_id,
      );
      if (
        b.state !== "draft" ||
        b.version !== req.body.version ||
        order.version !== b.order_version
      )
        fail(409, "Envio alterado ou já encaminhado.");
      await db.query("DELETE FROM zc_evidence WHERE id=$1", [item.id]);
      await db.query(
        "UPDATE zc_batches SET version=version+1,expected_count=expected_count-1 WHERE id=$1",
        [b.id],
      );
      await d.audit(
        db,
        String(req.user.id),
        "portal_photo_removed",
        "batch",
        b.id,
        { evidence_id: item.id },
      );
    });
    res.json({ ok: true });
  });
  app.get(prefix + "/evidence/:id", async (req, res) => {
    const item = await d.one(
      pool,
      "SELECT * FROM zc_evidence WHERE id=$1 AND state='ready'",
      [req.params.id],
    );
    if (!item) fail(404, "Foto indisponível.");
    await portal.ownBatch(pool, req.user.id, item.batch_id);
    if (!/^[-a-f0-9]+\.(?:jpg|pdf)$/.test(item.path))
      fail(404, "Foto indisponível.");
    res
      .type(item.mime)
      .set(
        "Content-Disposition",
        item.mime === "application/pdf"
          ? 'attachment; filename="checklist-assinado.pdf"'
          : "inline",
      )
      .set("Cache-Control", "no-store")
      .send(await createMediaStore(cfg).read(item.path));
  });
  // Every remaining central-management endpoint is forbidden to technicians.
  app.use("/api", (req, res, next) => {
    if (req.user.papel === "tecnico" && req.path !== "/auth/password")
      fail(403, "Este acesso não permite funções da central.");
    next();
  });
  app.get("/api/stock/catalog", auth.requireAdmin, async (req, res) =>
    res.json(await new StockClient(cfg).catalog()),
  );
  app.get("/api/service-rules", async (req, res) =>
    res.json({
      items: await d.rows(
        pool,
        "SELECT * FROM zc_service_rules ORDER BY service",
      ),
      photoKinds: portal.kinds,
    }),
  );
  app.patch(
    "/api/service-rules/:service",
    auth.requireAdmin,
    async (req, res) => {
      await transaction(pool, async (db) => {
        const rule = await portal.rule(db, req.params.service);
        if (rule.version !== req.body.version)
          fail(409, "Regra alterada. Atualize a tela.");
        const list = req.body.required_photos;
        if (!Array.isArray(list) || !list.length || list.length > 7)
          fail(400, "Defina entre um e sete tipos de evidência.");
        const seen = new Set();
        const photos = list.map((v) => {
          if (!v || !portal.kinds.includes(v.kind) || seen.has(v.kind))
            fail(400, "Tipo de evidência inválido ou duplicado.");
          seen.add(v.kind);
          return {
            kind: v.kind,
            label: d.string(v.label, "Nome da evidência", 120, true),
            min: integer(v.min, "Quantidade"),
          };
        });
        if (
          photos.some((p) => p.min > 10) ||
          photos.reduce((a, p) => a + p.min, 0) > 30
        )
          fail(400, "Limite total de 30 fotos.");
        if (
          rule.stock_action === "install" &&
          !photos.some((p) => p.kind === "label")
        )
          fail(400, "Instalações exigem foto de etiqueta por equipamento.");
        await db.query(
          "UPDATE zc_service_rules SET required_photos=$1::jsonb,version=version+1 WHERE service=$2",
          [JSON.stringify(photos), rule.service],
        );
        await d.audit(
          db,
          req.user.login,
          "service_rule_updated",
          "rule",
          rule.service,
          { photos },
        );
      });
      res.json({ ok: true });
    },
  );
  app.post("/api/batches/:id/approve", async (req, res) =>
    res.json(
      await portal.approve(
        pool,
        cfg,
        req.params.id,
        req.body,
        req.user.nome || req.user.login,
      ),
    ),
  );
  app.post("/api/batches/:id/reject", async (req, res) =>
    res.json(
      await portal.reject(
        pool,
        req.params.id,
        req.body,
        req.user.nome || req.user.login,
      ),
    ),
  );
  app.patch("/api/evidence/:id/classify", async (req, res) => {
    await transaction(pool, async (db) => {
      const e = await d.one(db, "SELECT * FROM zc_evidence WHERE id=$1", [
        req.params.id,
      ]);
      if (!e) fail(404, "Foto indisponível.");
      const b = await portal.batch(db, e.batch_id);
      if (
        !["draft", "submitted", "ready", "needs_review"].includes(b.state) ||
        req.body.version !== b.version
      )
        fail(409, "Envio indisponível para classificação.");
      if (
        b.capture_version >= 2 &&
        (e.kind === "label" ||
          e.kind === "checklist" ||
          ["label", "checklist"].includes(req.body.kind))
      )
        fail(
          409,
          "Preserve o equipamento identificado e o checklist. Solicite correção ao técnico.",
        );
      if (!portal.kinds.includes(req.body.kind))
        fail(400, "Tipo de evidência inválido.");
      await db.query(
        "UPDATE zc_evidence SET kind=$1,serial_code=$2 WHERE id=$3",
        [
          req.body.kind,
          d.string(req.body.serial_code || "", "IMEI/serial", 128),
          e.id,
        ],
      );
      await db.query("UPDATE zc_batches SET version=version+1 WHERE id=$1", [
        b.id,
      ]);
      await d.audit(db, req.user.login, "photo_classified", "batch", b.id, {
        evidence_id: e.id,
      });
    });
    res.json({ ok: true });
  });
}
module.exports = { configurePortal };
