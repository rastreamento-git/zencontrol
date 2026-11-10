const { rateLimit } = require("express-rate-limit");
const { transaction } = require("./database");
const { fail, integer } = require("./errors");
const { isStaff } = require("./field-access");
const { notify } = require("./notifications");

const pageSize = 50;
const directoryLimit = 200;
const directoryVersion = 1;
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const messageColumns =
  "m.id::text id,m.technician_id,m.sender_user_id,m.sender_name,m.sender_role,m.body,m.created_at";
const presence = (user) => `COALESCE((
  SELECT status FROM zc_chat_presence
  WHERE user_id=${user}.id AND seen_at>now()-interval '2 minutes'
  ORDER BY CASE status WHEN 'busy' THEN 1 WHEN 'online' THEN 2 ELSE 3 END
  LIMIT 1
),'offline')`;

function configureChat(app, pool) {
  const subscribers = new Set();
  const chatLimit = (limit, error) =>
    rateLimit({
      windowMs: 60000,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      keyGenerator: (req) => String(req.user.id),
      message: { error },
    });
  const sendLimit = chatLimit(30, "Muitas mensagens. Aguarde um minuto.");
  const presenceLimit = chatLimit(60, "Aguarde para atualizar seu status.");

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
    if (req.params.id === "equipe") {
      if (!access.staff) fail(404, "Conversa não encontrada.");
      return { id: null, access };
    }
    const id = integer(req.params.id, "Conversa");
    if (!access.staff) {
      if (id !== access.technician.id) fail(404, "Conversa não encontrada.");
      return { id, access };
    }
    if (
      !(
        await pool.query(
          "SELECT 1 FROM zc_technicians t JOIN zc_technician_accounts a ON a.technician_id=t.id JOIN usuarios u ON u.id=a.user_id WHERE t.id=$1 AND t.active=true AND u.ativo=true AND u.papel='tecnico'",
          [id],
        )
      ).rowCount
    )
      fail(404, "Conversa não encontrada.");
    return { id, access };
  }
  function signal(id, fromStaff) {
    for (const client of subscribers) {
      if (client.staff || client.technicianId === id)
        client.update(id !== null && client.staff !== fromStaff);
    }
  }

  app.put("/api/chat/presence", presenceLimit, async (req, res) => {
    if (!Number.isSafeInteger(req.user?.id)) fail(401, "Entre na sua conta.");
    const { client_id: clientId, status } = req.body;
    if (
      typeof clientId !== "string" ||
      !uuidPattern.test(clientId) ||
      !["online", "away", "busy"].includes(status)
    )
      fail(400, "Status de chat inválido.");
    await pool.query(
      `WITH expired AS (
         DELETE FROM zc_chat_presence WHERE seen_at<now()-interval '10 minutes'
           AND (user_id<>$1 OR client_id<>$2::uuid)
       )
       INSERT INTO zc_chat_presence(user_id,client_id,status) VALUES($1,$2,$3)
       ON CONFLICT(user_id,client_id) DO UPDATE SET status=EXCLUDED.status,seen_at=now()`,
      [req.user.id, clientId, status],
    );
    res.status(204).end();
  });
  app.get("/api/chat/team", async (req, res) => {
    if (!(await scope(req)).staff) fail(403, "Sala exclusiva da operação.");
    const { rows } = await pool.query(
      `SELECT u.id,u.nome name,u.papel role,p.avatar_version,${presence("u")} status
       FROM usuarios u LEFT JOIN zc_user_profiles p ON p.user_id=u.id
       WHERE u.ativo=true AND u.papel IN ('admin','operador')
       ORDER BY u.nome,u.id`,
    );
    res.json({ items: rows });
  });
  app.get("/api/chat/avatars/:id/:version", async (req, res) => {
    const access = await scope(req);
    const id = integer(req.params.id, "Perfil");
    if (!/^[a-f0-9]{64}$/.test(req.params.version))
      fail(404, "Foto indisponível.");
    if (
      !access.staff &&
      id !== req.user.id &&
      !(
        await pool.query(
          "SELECT 1 FROM zc_chat_messages WHERE technician_id=$1 AND sender_user_id=$2 AND sender_role IN ('admin','operador') LIMIT 1",
          [access.technician.id, id],
        )
      ).rowCount
    )
      fail(404, "Foto indisponível.");
    const { rows } = await pool.query(
      "SELECT avatar_webp FROM zc_user_profiles WHERE user_id=$1 AND avatar_version=$2",
      [id, req.params.version],
    );
    if (!rows[0]?.avatar_webp) fail(404, "Foto indisponível.");
    res.json({ image: "data:image/webp;base64," + rows[0].avatar_webp });
  });
  app.get("/api/chat/threads", async (req, res) => {
    const access = await scope(req);
    if (!access.staff) return res.json({ items: [access.technician] });
    const search =
      typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
    const { rows } = await pool.query(
      `SELECT t.id,t.name,account.id user_id,account.activation_required,p.avatar_version,${presence("account")} status,
              recent.body preview,recent.created_at,recent.id::text last_id
       FROM zc_technicians t
       LEFT JOIN LATERAL (
         SELECT u.id,u.activation_required FROM zc_technician_accounts a JOIN usuarios u ON u.id=a.user_id
         WHERE a.technician_id=t.id AND u.ativo=true AND u.papel='tecnico'
         ORDER BY u.id LIMIT 1
       ) account ON true
       LEFT JOIN zc_user_profiles p ON p.user_id=account.id
       LEFT JOIN LATERAL (
         SELECT id,body,created_at FROM zc_chat_messages WHERE technician_id=t.id ORDER BY id DESC LIMIT 1
       ) recent ON true
       WHERE t.active=true AND ($1='' OR strpos(lower(t.name),lower($1))>0)
       ORDER BY recent.id DESC NULLS LAST,t.name,t.id LIMIT $2`,
      [search, directoryLimit + 1],
    );
    res.json({
      items: rows.slice(0, directoryLimit),
      has_more: rows.length > directoryLimit,
      directory_version: directoryVersion,
    });
  });
  app.get("/api/chat/threads/:id/messages", async (req, res) => {
    const { id } = await thread(req);
    const before = req.query.before || null;
    if (
      before !== null &&
      (typeof before !== "string" ||
        !/^[1-9]\d{0,18}$/.test(before) ||
        BigInt(before) > 9223372036854775807n)
    )
      fail(400, "Página de mensagens inválida.");
    const where =
      id === null ? "m.technician_id IS NULL" : "m.technician_id=$3";
    const params = [before, pageSize + 1];
    if (id !== null) params.push(id);
    const { rows } = await pool.query(
      `SELECT ${messageColumns},p.avatar_version sender_avatar_version
       FROM zc_chat_messages m LEFT JOIN zc_user_profiles p ON p.user_id=m.sender_user_id
       WHERE ${where} AND ($1::bigint IS NULL OR m.id<$1::bigint)
       ORDER BY m.id DESC LIMIT $2`,
      params,
    );
    res.json({
      items: rows.slice(0, pageSize).reverse(),
      has_older: rows.length > pageSize,
    });
  });
  app.post("/api/chat/threads/:id/messages", sendLimit, async (req, res) => {
    const { id, access } = await thread(req);
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
    const { message, created } = await transaction(pool, async (db) => {
      const { rows } = await db.query(
        `INSERT INTO zc_chat_messages AS m(technician_id,sender_user_id,sender_name,sender_role,body,request_id)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING RETURNING ${messageColumns},
           (SELECT avatar_version FROM zc_user_profiles WHERE user_id=m.sender_user_id) sender_avatar_version`,
        [
          id,
          req.user.id,
          req.user.nome || req.user.login,
          req.user.papel,
          body,
          requestId,
        ],
      );
      if (rows[0]) {
        if (!access.staff)
          await notify(
            db,
            "central",
            null,
            "chat-message:" + rows[0].id,
            "Nova mensagem de técnico",
            { technician_id: id, technician: access.technician.name },
            "chat",
          );
        else if (id !== null)
          await notify(
            db,
            "technician",
            id,
            "chat-message:" + rows[0].id,
            "Nova mensagem da central",
            { reason: req.user.nome || req.user.login },
            "chat",
          );
        return { message: rows[0], created: true };
      }
      const duplicate = (
        await db.query(
          `SELECT ${messageColumns},p.avatar_version sender_avatar_version
           FROM zc_chat_messages m LEFT JOIN zc_user_profiles p ON p.user_id=m.sender_user_id
           WHERE m.technician_id IS NOT DISTINCT FROM $1::int AND m.sender_user_id=$2 AND m.request_id=$3`,
          [id, req.user.id, requestId],
        )
      ).rows[0];
      if (!duplicate || duplicate.body !== body)
        fail(409, "Este envio já foi usado.");
      return { message: duplicate, created: false };
    });
    if (created) signal(id, access.staff);
    res.status(created ? 201 : 200).json({ message });
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
      update: (notice) =>
        write(
          notice
            ? "event: notice\ndata: {}\n\n"
            : "event: change\ndata: {}\n\n",
        ),
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

module.exports = { configureChat, directoryVersion };
