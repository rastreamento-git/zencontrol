const {
  createHmac,
  createHash,
  timingSafeEqual,
  randomUUID,
  randomBytes,
  scrypt,
} = require("node:crypto");
const { promisify } = require("node:util");
const { rateLimit } = require("express-rate-limit");
const { fail, text } = require("./errors");
const { transaction } = require("./database");
const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function equal(a, b) {
  const hash = (v) => createHash("sha256").update(String(v)).digest();
  return timingSafeEqual(hash(a), hash(b));
}
function username(value) {
  const login = text(value, "Usuário", 48).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,47}$/.test(login))
    fail(
      400,
      "Usuário: 3 a 48 caracteres, usando letras, números, ponto, hífen ou sublinhado.",
    );
  return login;
}
function password(value) {
  if (
    typeof value !== "string" || value.length < 8 || value.length > 128 ||
    !/\p{Lu}/u.test(value) || !/\p{Ll}/u.test(value) ||
    !/[0-9]/.test(value) || !/[\p{P}\p{S}]/u.test(value)
  )
    fail(400, "Use de 8 a 128 caracteres, com pelo menos uma letra maiúscula, uma minúscula, um número e um símbolo.");
  return value;
}
async function hashPassword(value) {
  return hashCredential(password(value));
}
// Bootstrap reuses the already configured administrator credential. New user
// passwords always pass through hashPassword; existing logins are not revalidated.
async function hashCredential(value) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(value, salt, 64, options);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}
async function checkPassword(value, stored) {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    typeof stored !== "string"
  )
    return false;
  const [method, salt, hex] = stored.split("$");
  if (
    method !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt) ||
    !/^[a-f0-9]{128}$/.test(hex)
  )
    return false;
  const hash = await derive(value, salt, 64, options);
  return timingSafeEqual(hash, Buffer.from(hex, "hex"));
}
function publicUser(row) {
  return {
    id: row.id,
    login: row.login,
    nome: row.nome,
    papel: row.papel,
    ativo: row.ativo,
    criado_em: row.criado_em,
  };
}
function configureAuth(app, env, pool) {
  const enabled = Boolean(env.APP_PASSWORD);
  if (
    env.NODE_ENV === "production" &&
    (!enabled || env.APP_PASSWORD.length < 8)
  )
    throw Error("Produção exige APP_PASSWORD com pelo menos 8 caracteres.");
  if (enabled && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32))
    throw Error("Configure SESSION_SECRET com pelo menos 32 caracteres.");
  let initialization;
  const initialLogin = username(env.APP_ADMIN_USER || "admin");
  async function ready() {
    if (!enabled) return;
    if (!initialization)
      initialization = (async () => {
        const existing = await pool.query("SELECT id FROM usuarios LIMIT 1");
        if (existing.rowCount) return;
        const hash = await hashCredential(env.APP_PASSWORD);
        await pool.query(
          "INSERT INTO usuarios (login,nome,senha_hash,papel) VALUES ($1,'Administrador',$2,'admin') ON CONFLICT(login) DO NOTHING",
          [initialLogin, hash],
        );
      })().catch((error) => {
        initialization = null;
        throw error;
      });
    return initialization;
  }
  const sign = (payload) =>
    createHmac("sha256", env.SESSION_SECRET)
      .update(payload)
      .digest("base64url");
  async function valid(req) {
    if (!enabled)
      return {
        id: null,
        login: "desenvolvimento",
        nome: "Desenvolvimento",
        papel: "admin",
        ativo: true,
      };
    const parts = (req.headers.authorization || "")
      .replace(/^Bearer /, "")
      .split(".");
    if (
      parts.length !== 2 ||
      parts[0].length > 2048 ||
      !equal(parts[1], sign(parts[0]))
    )
      return null;
    let data;
    try {
      data = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    } catch {
      return null;
    }
    if (
      !Number.isSafeInteger(data.exp) ||
      data.exp <= Date.now() ||
      !Number.isSafeInteger(data.uid)
    )
      return null;
    await ready();
    const { rows } = await pool.query(
      "SELECT * FROM usuarios WHERE id=$1 AND ativo=true",
      [data.uid],
    );
    const row = rows[0];
    if (!row || row.activation_required || data.version !== row.versao_sessao)
      return null;
    if (
      row.papel === "tecnico" &&
      !(
        await pool.query(
          "SELECT 1 FROM zc_technician_accounts a JOIN zc_technicians t ON t.id=a.technician_id WHERE a.user_id=$1 AND t.active=true",
          [row.id],
        )
      ).rowCount
    )
      return null;
    return publicUser(row);
  }
  app.get("/api/auth/session", async (req, res) => {
    await ready();
    const user = await valid(req);
    res.json({
      enabled,
      authenticated: Boolean(user),
      user,
      api_version: "6.4.0",
    });
  });
  const attempts = rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Muitas tentativas. Aguarde 15 minutos." },
  });
  const logAuth = (uid, event) =>
    pool.query(
      "INSERT INTO zc_auth_events(id,user_id,event) VALUES($1,$2,$3)",
      [randomUUID(), uid || null, event],
    );
  app.post("/api/auth/activate", attempts, async (req, res) => {
    const login = String(req.body.login || "")
      .trim()
      .toLowerCase();
    const nextHash = await hashPassword(req.body.new_password);
    const result = await transaction(pool, async (db) => {
      const row = (
        await db.query(
          "SELECT u.*,a.code_hash,a.expires_at,a.used_at FROM usuarios u JOIN zc_activations a ON a.user_id=u.id WHERE u.login=$1 FOR UPDATE",
          [login],
        )
      ).rows[0];
      const codeHash = createHash("sha256")
        .update(String(req.body.code || ""))
        .digest("hex");
      if (
        !row?.ativo ||
        !row.activation_required ||
        row.used_at ||
        new Date(row.expires_at).getTime() <= Date.now() ||
        req.body.password !== "zen123" ||
        !equal(codeHash, row.code_hash)
      )
        return null;
      if (
        !(
          await db.query(
            "SELECT 1 FROM zc_technician_accounts a JOIN zc_technicians t ON t.id=a.technician_id WHERE a.user_id=$1 AND t.active=true",
            [row.id],
          )
        ).rowCount
      )
        return null;
      await db.query(
        "UPDATE usuarios SET senha_hash=$1,activation_required=false,versao_sessao=versao_sessao+1 WHERE id=$2",
        [nextHash, row.id],
      );
      await db.query(
        "UPDATE zc_activations SET used_at=now() WHERE user_id=$1",
        [row.id],
      );
      await db.query(
        "INSERT INTO zc_auth_events(id,user_id,event) VALUES($1,$2,'activated')",
        [randomUUID(), row.id],
      );
      return row.id;
    });
    if (!result) {
      await logAuth(null, "activation_failed");
      fail(
        401,
        "Ativação inválida ou expirada. Solicite um novo código à central.",
      );
    }
    res.json({ ok: true, message: "Conta ativada. Entre com sua nova senha." });
  });
  app.post(
    "/api/auth/login",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Muitas tentativas. Aguarde 15 minutos." },
    }),
    async (req, res) => {
      if (!enabled)
        return res.json({
          enabled: false,
          token: null,
          user: await valid(req),
        });
      await ready();
      const login =
        typeof req.body?.login === "string"
          ? req.body.login.trim().toLowerCase()
          : initialLogin;
      const { rows } = await pool.query(
        "SELECT * FROM usuarios WHERE login=$1",
        [login],
      );
      const row = rows[0];
      // Unknown logins still run scrypt against the seeded administrator hash.
      const fallback =
        row ||
        (
          await pool.query(
            "SELECT senha_hash FROM usuarios ORDER BY id LIMIT 1",
          )
        ).rows[0];
      const correct = await checkPassword(
        req.body?.password,
        fallback?.senha_hash,
      );
      if (!row?.ativo || !correct || row.activation_required) {
        await logAuth(row?.id, "login_failed");
        fail(
          401,
          "Usuário ou senha incorretos. No primeiro acesso, use a ativação fornecida pela central.",
        );
      }
      if (
        row.papel === "tecnico" &&
        !(
          await pool.query(
            "SELECT 1 FROM zc_technician_accounts a JOIN zc_technicians t ON t.id=a.technician_id WHERE a.user_id=$1 AND t.active=true",
            [row.id],
          )
        ).rowCount
      )
        fail(403, "Cadastro técnico inativo.");
      const audience = req.body.audience;
      if (
        audience !== undefined &&
        !["central", "technician", "ecosystem"].includes(audience)
      )
        fail(400, "Área de acesso inválida.");
      if (audience === "technician" && row.papel !== "tecnico")
        fail(403, "Use uma conta de técnico para entrar neste portal.");
      if (audience === "central" && row.papel === "tecnico")
        fail(403, "Esta conta é de técnico. Entre pelo Portal do Técnico.");
      await logAuth(row.id, "login_succeeded");
      res.json({
        enabled: true,
        ...issueToken(row),
        api_version: "6.4.0",
        user: publicUser(row),
      });
    },
  );
  function issueToken(row) {
    const exp = Date.now() + 8 * 60 * 60000;
    const payload = Buffer.from(
      JSON.stringify({
        exp,
        uid: row.id,
        version: row.versao_sessao,
        jti: randomUUID(),
      }),
    ).toString("base64url");
    return { token: `${payload}.${sign(payload)}`, expiresAt: exp };
  }
  require("./sso").configureSso(app, env, pool, {
    valid,
    issueToken,
    publicUser,
    checkPassword,
  });
  app.use("/api", async (req, res, next) => {
    const user = await valid(req);
    if (!user)
      return res
        .status(401)
        .json({ error: "Entre com usuário e senha para continuar." });
    req.user = user;
    next();
  });
  function requireAdmin(req, res, next) {
    if (req.user?.papel !== "admin")
      fail(403, "Esta ação exige um administrador.");
    next();
  }
  async function reauthenticate(req) {
    if (!enabled)
      fail(403, "Configure acesso por senha para usar ações administrativas.");
    const { rows } = await pool.query(
      "SELECT senha_hash FROM usuarios WHERE id=$1 AND ativo=true AND papel='admin'",
      [req.user.id],
    );
    if (!(await checkPassword(req.body?.password, rows[0]?.senha_hash)))
      fail(400, "A senha atual não confere.");
  }
  return { ready, requireAdmin, reauthenticate, enabled };
}
module.exports = {
  configureAuth,
  username,
  password,
  hashPassword,
  checkPassword,
  publicUser,
};
