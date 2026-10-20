const { createHash } = require("node:crypto");
const { transaction } = require("./database");
const { fail, text, integer } = require("./errors");
const { username, password, hashPassword, publicUser } = require("./auth");
const tables = [
  "produtos",
  "tecnicos",
  "estoque_tecnicos",
  "equipamentos_seriais",
  "movimentacoes",
  "eventos_seriais",
  "zencontrol_installations",
];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !(value instanceof Date))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const digest = (data) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(data)))
    .digest("hex");
async function snapshot(client) {
  const data = {};
  for (const table of tables)
    data[table] = (
      await client.query(
        `SELECT * FROM ${table} ORDER BY ${table === "equipamentos_seriais" ? "codigo_serial" : "id"}`,
      )
    ).rows;
  // Convert pg Date values to the JSON representation used in downloads.
  return JSON.parse(JSON.stringify(data));
}
async function audit(client, user, action, details = {}) {
  await client.query(
    "INSERT INTO auditoria_admin (usuario_id,operador,acao,detalhes) VALUES ($1,$2,$3,$4::jsonb)",
    [user.id, user.login, action, JSON.stringify(details)],
  );
}
async function backup(pool) {
  return transaction(pool, async (client) => {
    const data = await snapshot(client);
    return {
      format: "estoquepro-inventory",
      version: 1,
      exportedAt: new Date().toISOString(),
      counts: Object.fromEntries(tables.map((t) => [t, data[t].length])),
      checksum: digest(data),
      data,
    };
  });
}
function validateBackup(value) {
  if (
    !value ||
    value.format !== "estoquepro-inventory" ||
    value.version !== 1 ||
    !value.data ||
    typeof value.data !== "object"
  )
    fail(400, "Arquivo não é um backup compatível do inventário.");
  const incomingTables = Object.keys(value.data).sort();
  const legacyTables = tables
    .filter((t) => t !== "zencontrol_installations")
    .toSorted();
  const legacy = incomingTables.join(",") === legacyTables.join(",");
  if (
    (!legacy &&
      Object.keys(value.data).sort().join(",") !==
        tables.toSorted().join(",")) ||
    (legacy ? legacyTables : tables).some(
      (t) =>
        !Array.isArray(value.data[t]) ||
        value.data[t].some(
          (r) => !r || typeof r !== "object" || Array.isArray(r),
        ),
    )
  )
    fail(400, "Tabelas do backup inválidas.");
  if (value.checksum !== digest(value.data))
    fail(
      400,
      "O conteúdo do backup não confere com sua verificação de integridade.",
    );
  return legacy
    ? { ...value, data: { ...value.data, zencontrol_installations: [] } }
    : value;
}
async function verifyCurrent(client, expected) {
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
    fail(400, "Baixe um backup do estado atual antes de continuar.");
  const data = await snapshot(client);
  if (digest(data) !== expected)
    fail(
      409,
      "O inventário mudou após o backup. Baixe um novo backup antes de confirmar.",
    );
  return data;
}
function configureAdmin(app, pool, auth) {
  app.use("/api/admin", auth.requireAdmin);
  app.use("/api/admin/users", (req, res, next) => {
    if (auth.federated)
      fail(
        409,
        "Gerencie as contas ZEN em ZenControl → Usuários. O perfil vale também para o Estoque Pro.",
      );
    next();
  });
  app.get("/api/admin/users", async (req, res) =>
    res.json(
      (await pool.query("SELECT * FROM usuarios ORDER BY nome,id")).rows.map(
        publicUser,
      ),
    ),
  );
  app.post("/api/admin/users", async (req, res) => {
    const login = username(req.body.login),
      nome = text(req.body.nome, "Nome");
    const papel = req.body.papel || "operador";
    if (!["admin", "operador"].includes(papel)) fail(400, "Perfil inválido.");
    const hash = await hashPassword(password(req.body.password));
    const user = await transaction(pool, async (client) => {
      if (
        (await client.query("SELECT id FROM usuarios WHERE login=$1", [login]))
          .rowCount
      )
        fail(409, "Já existe um usuário com esse login.");
      const result = await client.query(
        "INSERT INTO usuarios (login,nome,senha_hash,papel) VALUES ($1,$2,$3,$4) RETURNING *",
        [login, nome, hash, papel],
      );
      await audit(client, req.user, "USUARIO_CRIADO", {
        id: result.rows[0].id,
        login,
        papel,
      });
      return publicUser(result.rows[0]);
    });
    res.status(201).json({ success: true, user });
  });
  app.put("/api/admin/users/:id", async (req, res) => {
    const id = integer(req.params.id, "Usuário");
    if (req.body.ativo !== undefined && typeof req.body.ativo !== "boolean")
      fail(400, "Ativo deve ser booleano.");
    const papel = req.body.papel;
    if (papel !== undefined && !["admin", "operador"].includes(papel))
      fail(400, "Perfil inválido.");
    const hash =
      req.body.nova_senha === undefined
        ? null
        : await hashPassword(password(req.body.nova_senha));
    const user = await transaction(pool, async (client) => {
      const row = (
        await client.query("SELECT * FROM usuarios WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      if (!row) fail(404, "Usuário não encontrado.");
      const active = req.body.ativo ?? row.ativo,
        role = papel ?? row.papel;
      if (
        id === req.user.id &&
        (!active || (row.papel === "admin" && role !== "admin"))
      )
        fail(
          409,
          "Você não pode desativar ou retirar seu próprio perfil de administrador.",
        );
      if (row.ativo && row.papel === "admin" && (!active || role !== "admin")) {
        if (
          !(
            await client.query(
              "SELECT id FROM usuarios WHERE ativo AND papel='admin' AND id<>$1",
              [id],
            )
          ).rowCount
        )
          fail(409, "Mantenha ao menos um administrador ativo.");
      }
      const result = await client.query(
        "UPDATE usuarios SET ativo=$1,papel=$2,senha_hash=COALESCE($3,senha_hash),versao_sessao=versao_sessao+1 WHERE id=$4 RETURNING *",
        [active, role, hash, id],
      );
      await audit(client, req.user, "USUARIO_ATUALIZADO", {
        id,
        ativo: active,
        papel: role,
        senha_alterada: Boolean(hash),
      });
      return publicUser(result.rows[0]);
    });
    res.json({ success: true, user });
  });
  app.get("/api/admin/backup", async (req, res) =>
    res.json(await backup(pool)),
  );
  const sensitiveLimit = require("express-rate-limit").rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Muitas confirmações. Aguarde 15 minutos." },
  });
  app.post("/api/admin/reset", sensitiveLimit, async (req, res) => {
    if (req.body.confirmation !== "thereisnourflevel")
      fail(400, "Confirme o reset pelo painel administrativo.");
    const scope = req.body.scope || "all";
    if (!["all", "stock"].includes(scope))
      fail(400, "Escopo de reset inválido.");
    await auth.reauthenticate(req);
    const result = await transaction(pool, async (client) => {
      const data = await verifyCurrent(client, req.body.expectedChecksum);
      if (scope === "all")
        await client.query(
          "TRUNCATE zencontrol_installations,eventos_seriais,movimentacoes,equipamentos_seriais,estoque_tecnicos,tecnicos,produtos RESTART IDENTITY",
        );
      else {
        await client.query(
          "TRUNCATE zencontrol_installations,eventos_seriais,movimentacoes,equipamentos_seriais,estoque_tecnicos RESTART IDENTITY",
        );
        await client.query("UPDATE produtos SET quantidade_matriz=0");
      }
      await audit(client, req.user, "RESET_INVENTARIO", {
        scope,
        checksum: req.body.expectedChecksum,
        counts: Object.fromEntries(tables.map((t) => [t, data[t].length])),
      });
      return { success: true, scope };
    });
    res.json(result);
  });
  app.post("/api/admin/restore", sensitiveLimit, async (req, res) => {
    if (req.body.confirmation !== "restaurar")
      fail(400, "Confirme a restauração pelo painel administrativo.");
    const value = validateBackup(req.body.backup);
    await auth.reauthenticate(req);
    await transaction(pool, async (client) => {
      await verifyCurrent(client, req.body.expectedChecksum);
      await client.query(
        "TRUNCATE zencontrol_installations,eventos_seriais,movimentacoes,equipamentos_seriais,estoque_tecnicos,tecnicos,produtos RESTART IDENTITY",
      );
      for (const table of tables) {
        // Table/column names come only from our fixed schema; values are parameterized.
        const columns = (
          await client.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position",
            [table],
          )
        ).rows.map((r) => r.column_name);
        if (
          value.data[table].some((row) =>
            Object.keys(row).some((k) => !columns.includes(k)),
          )
        )
          fail(400, `Coluna desconhecida no backup de ${table}.`);
        if (value.data[table].length)
          await client.query(
            `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(",")}) SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM json_populate_recordset(NULL::${table},$1::json)`,
            [JSON.stringify(value.data[table])],
          );
        if (
          !["equipamentos_seriais", "zencontrol_installations"].includes(table)
        )
          await client.query(
            `SELECT setval(pg_get_serial_sequence('${table}','id'),COALESCE(MAX(id),1),MAX(id) IS NOT NULL) FROM ${table}`,
          );
      }
      await audit(client, req.user, "BACKUP_RESTAURADO", {
        checksum: value.checksum,
        exportedAt: value.exportedAt,
      });
    });
    res.json({ success: true });
  });
  app.get("/api/admin/audit", async (req, res) =>
    res.json(
      (
        await pool.query(
          "SELECT operador,acao,detalhes,criado_em FROM auditoria_admin ORDER BY id DESC LIMIT 100",
        )
      ).rows,
    ),
  );
}
module.exports = { configureAdmin, backup, digest, validateBackup };
