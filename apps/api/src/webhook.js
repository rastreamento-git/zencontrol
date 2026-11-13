const { randomUUID, createHash, timingSafeEqual } = require("node:crypto");
const { transaction } = require("./database");
const { fail } = require("./errors");
const d = require("./domain");
const orders = require("./orders");
const ident = (v) =>
  String(v && typeof v === "object" ? v._serialized || v.id || "" : v || "");
function vehicleText(text) {
  for (const line of text
    .replaceAll("*", "")
    .replaceAll("_", "")
    .toUpperCase()
    .split("\n")) {
    const m = line.match(
      /(?:PLACA(?:\s+OU\s+CHASSI)?|CHASSI|IDENTIFICAÇÃO)\s*:\s*([A-Z0-9-]+)/,
    );
    if (m) {
      const v = d.vehicle(m[1]);
      if (v.length >= 7 && v.length <= 30) return v;
    }
  }
  return "";
}
async function resolve(db, sender, author) {
  const techs = await d.rows(
    db,
    "SELECT * FROM zc_technicians WHERE active=true",
  );
  const group = sender.endsWith("@g.us");
  const phone = (group ? author : sender).split("@")[0].replace(/\D/g, "");
  const candidates = group
    ? techs.filter((t) => t.receive_group === sender)
    : techs;
  const exact = candidates.filter(
    (t) => phone && t.phone.replace(/\D/g, "") === phone,
  );
  return exact.length === 1
    ? exact[0]
    : group && candidates.length === 1
      ? candidates[0]
      : null;
}
async function store(db, s, sender, hub, reason = "") {
  if (!s.text && !s.message_ids.length) return null;
  const list = await d.rows(
    db,
    "SELECT * FROM zc_orders WHERE technician_id=$1 AND workflow_mode='legacy' AND deleted_at='' AND status NOT IN ('CONCLUÍDO','CANCELADO')",
    [s.technician_id],
  );
  const explicit = s.text.toUpperCase().match(/\bOS\s*:\s*([A-Z0-9_-]+)/);
  const matches = list.filter(
    (o) =>
      (!explicit || o.id.toUpperCase() === explicit[1]) &&
      s.vehicle &&
      [d.vehicle(o.vehicle), d.vehicle(o.chassis)].includes(s.vehicle),
  );
  const oid = matches.length === 1 ? matches[0].id : null;
  const ids = [...new Set(s.message_ids)];
  const id = randomUUID();
  await orders.insert(db, "zc_batches", {
    id,
    order_id: oid,
    technician_id: s.technician_id,
    sender,
    vehicle: s.vehicle,
    notes: s.text,
    state: ids.length ? "downloading" : "needs_review",
    expected_count: ids.length,
    hub,
    created_at: d.now(),
    reason:
      reason ||
      (!oid
        ? "Não foi encontrada exatamente uma OS aberta para este veículo e técnico."
        : ""),
  });
  for (const mid of ids)
    await orders.insert(db, "zc_evidence", {
      id: randomUUID(),
      batch_id: id,
      message_id: mid,
    });
  if (ids.length)
    await orders.enqueue(
      db,
      "download_evidence",
      oid,
      { batch_id: id },
      "batch:" + id,
    );
  await d.audit(db, "webhook", "batch_received", "batch", id, {
    order_id: oid,
    photos: ids.length,
    hub,
  });
  return id;
}
function configureWebhook(app, pool, cfg) {
  app.post("/webhook", async (req, res) => {
    const expected = createHash("sha256")
      .update(cfg.ZEN_WEBHOOK_SECRET)
      .digest();
    const given = createHash("sha256")
      .update(String(req.get("X-Webhook-Token") || req.query.token || ""))
      .digest();
    if (!timingSafeEqual(expected, given)) fail(401, "Webhook não autorizado.");
    const p = req.body;
    if (!p || typeof p !== "object" || Array.isArray(p))
      fail(400, "Evento inválido.");
    if (["qrcode", "status-find"].includes(p.event)) {
      const qr = String(p.qrcode || p.base64 || "")
        .split(",")
        .at(-1);
      app.locals.wpp = {
        status: p.event === "qrcode" ? "QRCODE" : String(p.status),
        ...(p.event === "qrcode" && qr.length < 200000 ? { qr } : {}),
        received_at: Date.now(),
      };
      return res.json({ ok: true });
    }
    if (!["onmessage", "onanymessage", "message"].includes(p.event))
      return res.json({ ignored: true });
    const msg = p.data && typeof p.data === "object" ? p.data : p;
    if (p.isHistorical || msg.isHistorical || p.fromMe || msg.fromMe)
      return res.json({ ignored: true });
    const sender = ident(msg.from),
      author = ident(msg.author),
      mid = ident(msg.id);
    const body = String(msg.body || msg.caption || "").trim();
    if (!sender || !mid) return res.json({ ignored: true });
    if (body.length > 10000) fail(400, "Mensagem muito longa.");
    const result = await transaction(pool, async (db) => {
      const tech = await resolve(db, sender, author);
      if (!tech) return { ignored: true, reason: "unknown_technician" };
      if (
        await d.one(db, "SELECT 1 FROM zc_webhook_events WHERE message_id=$1", [
          mid,
        ])
      )
        return { duplicate: true };
      await orders.insert(db, "zc_webhook_events", {
        message_id: mid,
        received_at: d.now(),
      });
      const key = sender + "|" + author;
      let old = await d.one(
        db,
        "SELECT * FROM zc_wa_sessions WHERE session_key=$1",
        [key],
      );
      if (old && Date.now() - old.updated_at > 3600000) {
        await d.audit(
          db,
          "webhook",
          "expired_session",
          "technician",
          tech.id,
          old.payload,
        );
        old = null;
      }
      let s = old?.payload || {
        text: "",
        vehicle: "",
        message_ids: [],
        technician_id: tech.id,
      };
      if (s.technician_id !== tech.id) fail(409, "O técnico do bloco mudou.");
      const media = ["image", "document"].includes(msg.type) || msg.isMedia;
      if (![".", "#.#"].includes(body)) {
        const v = vehicleText(body);
        if (v && s.vehicle && v !== s.vehicle) {
          await store(
            db,
            s,
            sender,
            true,
            "Outro veículo foi recebido antes de finalizar o bloco.",
          );
          s = {
            text: "",
            vehicle: "",
            message_ids: [],
            technician_id: tech.id,
          };
        }
        if (media && !s.message_ids.includes(mid)) s.message_ids.push(mid);
        if (s.message_ids.length > 30)
          fail(400, "Limite de 30 fotos por bloco.");
        s.text = (s.text + "\n" + body).trim();
        if (s.text.length > 20000) fail(400, "Bloco muito longo.");
        s.vehicle = v || s.vehicle;
        await db.query(
          "INSERT INTO zc_wa_sessions(session_key,payload,updated_at) VALUES($1,$2::jsonb,$3) ON CONFLICT(session_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at",
          [key, JSON.stringify(s), Date.now()],
        );
        return { ok: true, buffered: true };
      }
      const bid = await store(db, s, sender, body === "#.#");
      await db.query("DELETE FROM zc_wa_sessions WHERE session_key=$1", [key]);
      return { ok: true, batch_id: bid };
    });
    res.json(result);
  });
}
module.exports = { configureWebhook, vehicleText };
