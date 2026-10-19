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
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    fail(400, "A senha deve ter entre 12 e 128 caracteres.");
  return value;
}
async function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password(value), salt, 64, options);
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
  const federation = require("./identity").identity(env, pool, publicUser);
  if (
    env.NODE_ENV === "production" &&
    (!enabled || env.APP_PASSWORD.length < 12)
  )
    throw Error("Produção exige APP_PASSWORD com pelo menos 12 caracteres.");
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
        const hash = await hashPassword(env.APP_PASSWORD);
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
    if (federation.enabled) return federation.valid(req);
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
    return row && data.version === row.versao_sessao ? publicUser(row) : null;
  }
  app.get("/api/auth/config", (req, res) =>
    res.json({
      unified_login: federation.enabled,
      login_url: federation.enabled ? env.ZEN_LOGIN_URL : "",
    }),
  );
  app.post(
    "/api/auth/sso/exchange",
    rateLimit({
      windowMs: 60000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    async (req, res) => {
      if (!federation.enabled) fail(503, "Acesso único não configurado.");
      res.json(await federation.exchange(req.body));
    },
  );
  app.post("/api/auth/logout", async (req, res) => {
    if (federation.enabled) {
      try {
        await federation.logout(req);
      } catch (error) {
        if (![401, 403].includes(error.status)) throw error;
      }
    } else {
      const user = await valid(req);
      if (user?.id)
        await pool.query(
          "UPDATE usuarios SET versao_sessao=versao_sessao+1 WHERE id=$1",
          [user.id],
        );
    }
    res.json({ ok: true });
  });
  app.get("/api/auth/session", async (req, res) => {
    await ready();
    const user = await valid(req);
    res.json({ enabled, authenticated: Boolean(user), user });
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
      if (federation.enabled) fail(409, "Entre pelo acesso único ZEN.");
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
      if (!row?.ativo || !correct) fail(401, "Usuário ou senha incorretos.");
      const exp = Date.now() + 8 * 60 * 60000;
      const payload = Buffer.from(
        JSON.stringify({
          exp,
          uid: row.id,
          version: row.versao_sessao,
          jti: randomUUID(),
        }),
      ).toString("base64url");
      res.json({
        enabled: true,
        token: `${payload}.${sign(payload)}`,
        expiresAt: exp,
        user: publicUser(row),
      });
    },
  );
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
    if (federation.enabled) return federation.reauthenticate(req);
    if (!enabled)
      fail(403, "Configure acesso por senha para usar ações administrativas.");
    const { rows } = await pool.query(
      "SELECT senha_hash FROM usuarios WHERE id=$1 AND ativo=true AND papel='admin'",
      [req.user.id],
    );
    if (!(await checkPassword(req.body?.password, rows[0]?.senha_hash)))
      fail(400, "A senha atual não confere.");
  }
  return {
    ready,
    requireAdmin,
    reauthenticate,
    enabled,
    federated: federation.enabled,
  };
}
module.exports = {
  configureAuth,
  username,
  password,
  hashPassword,
  checkPassword,
  publicUser,
};
