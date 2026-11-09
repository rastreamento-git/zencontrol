const { rateLimit } = require("express-rate-limit");
const { fail, integer } = require("./errors");
const { isStaff } = require("./field-access");

const pageSize = 50;
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const messageColumns =
  "id::text id,technician_id,sender_user_id,sender_name,sender_role,body,created_at";

function configureChat(app, pool) {
  const subscribers = new Set();
  const sendLimit = rateLimit({
    windowMs: 60000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user.id),
    message: { error: "Muitas mensagens. Aguarde um minuto." },
  });

  async function scope(req) {
    if (!Number.isSafeInteger(req.user?.id)) fail(401, "Entre na sua conta.");
    if (isStaff(req.user)) return { staff: true };
    if (req.user.papel !== "tecnico")
      fail(403, "Chat não disponível neste perfil.");
    const technician = (
      await pool.query(
        "SELECT t.id,t.name FROM zc_technician_accounts a JOIN zc_technicians t ON t.id=a.technician_id WHERE a.user_id=$1 AND t.active=true",
        [req.user.id],
      )
    ).rows[0];
    if (!technician) fail(403, "Cadastro técnico inativo.");
    return { staff: false, technician };
  }
  async function thread(req) {
    const access = await scope(req);
    const id = integer(req.params.id, "Conversa");
    if (!access.staff) {
      if (id !== access.technician.id) fail(404, "Conversa não encontrada.");
      return id;
    }
    if (
      !(
        await pool.query(
          "SELECT 1 FROM zc_technicians t JOIN zc_technician_accounts a ON a.technician_id=t.id JOIN usuarios u ON u.id=a.user_id WHERE t.id=$1 AND t.active=true AND u.ativo=true AND u.papel='tecnico' AND u.activation_required=false",
          [id],
        )
      ).rowCount
    )
      fail(404, "Conversa não encontrada.");
    return id;
  }
  function signal(id) {
    for (const client of subscribers) {
      if (client.staff || client.technicianId === id) client.update();
    }
  }

  app.get("/api/chat/threads", async (req, res) => {
    const access = await scope(req);
    if (!access.staff) return res.json({ items: [access.technician] });
    const search =
      typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
    const { rows } = await pool.query(
      `SELECT t.id,t.name,recent.body preview,recent.created_at,recent.id::text last_id
       FROM zc_technicians t
       LEFT JOIN LATERAL (
         SELECT id,body,created_at FROM zc_chat_messages WHERE technician_id=t.id ORDER BY id DESC LIMIT 1
       ) recent ON true
       WHERE t.active=true AND EXISTS (
         SELECT 1 FROM zc_technician_accounts a JOIN usuarios u ON u.id=a.user_id
         WHERE a.technician_id=t.id AND u.ativo=true AND u.papel='tecnico' AND u.activation_required=false
       )
         AND ($1='' OR strpos(lower(t.name),lower($1))>0)
       ORDER BY recent.id DESC NULLS LAST,t.name,t.id LIMIT 200`,
      [search],
    );
    res.json({ items: rows });
  });
  app.get("/api/chat/threads/:id/messages", async (req, res) => {
    const id = await thread(req);
    const before = req.query.before || null;
    if (
      before !== null &&
      (typeof before !== "string" ||
        !/^[1-9]\d{0,18}$/.test(before) ||
        BigInt(before) > 9223372036854775807n)
    )
      fail(400, "Página de mensagens inválida.");
    const { rows } = await pool.query(
      `SELECT ${messageColumns} FROM zc_chat_messages
       WHERE technician_id=$1 AND ($2::bigint IS NULL OR zc_chat_messages.id<$2::bigint)
       ORDER BY zc_chat_messages.id DESC LIMIT $3`,
      [id, before, pageSize + 1],
    );
    res.json({
      items: rows.slice(0, pageSize).reverse(),
      has_older: rows.length > pageSize,
    });
  });
  app.post("/api/chat/threads/:id/messages", sendLimit, async (req, res) => {
    const id = await thread(req);
    const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
    const requestId = req.body.request_id;
    if (
      !body ||
      body.length > 2000 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body)
    )
      fail(400, "Escreva uma mensagem de até 2.000 caracteres.");
    if (typeof requestId !== "string" || !uuidPattern.test(requestId))
      fail(400, "Envio inválido. Tente novamente.");
    const { rows } = await pool.query(
      `INSERT INTO zc_chat_messages(technician_id,sender_user_id,sender_name,sender_role,body,request_id)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(technician_id,sender_user_id,request_id) DO NOTHING RETURNING ${messageColumns}`,
      [
        id,
        req.user.id,
        req.user.nome || req.user.login,
        req.user.papel,
        body,
        requestId,
      ],
    );
    let message = rows[0];
    if (!message) {
      message = (
        await pool.query(
          `SELECT ${messageColumns} FROM zc_chat_messages WHERE technician_id=$1 AND sender_user_id=$2 AND request_id=$3`,
          [id, req.user.id, requestId],
        )
      ).rows[0];
      if (!message || message.body !== body)
        fail(409, "Este envio já foi usado.");
    } else signal(id);
    res.status(rows.length ? 201 : 200).json({ message });
  });
  app.get("/api/chat/stream", async (req, res) => {
    const access = await scope(req);
    if (
      subscribers.size >= 100 ||
      [...subscribers].filter((client) => client.userId === req.user.id)
        .length >= 3
    )
      fail(429, "Limite de conexões de chat alcançado.");
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });
    const client = {
      userId: req.user.id,
      staff: access.staff,
      technicianId: access.technician?.id,
      update: () => write("event: change\ndata: {}\n\n"),
    };
    function write(chunk) {
      if (!res.destroyed && !res.writableEnded && !res.write(chunk)) res.end();
    }
    const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15000);
    const expiry = setTimeout(() => res.end(), 120000);
    heartbeat.unref();
    expiry.unref();
    res.on("close", () => {
      subscribers.delete(client);
      clearInterval(heartbeat);
      clearTimeout(expiry);
    });
    subscribers.add(client);
    res.flushHeaders();
    write("event: ready\ndata: {}\n\n");
  });
}

module.exports = { configureChat };
