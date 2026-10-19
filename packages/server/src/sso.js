const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const { rateLimit } = require("express-rate-limit");
const { fail } = require("./errors");
const { transaction } = require("./database");
const digest = (value) =>
  createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
const challengeFor = (value) =>
  createHash("sha256").update(value).digest("base64url");
const equal = (a, b) =>
  timingSafeEqual(Buffer.from(digest(a), "hex"), Buffer.from(digest(b), "hex"));
function origin(value) {
  if (!value) return "";
  let u;
  try {
    u = new URL(value);
  } catch {
    fail(500, "Endereço de acesso ZEN inválido.");
  }
  if (
    (u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname)
      )) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    fail(500, "Endereço de acesso ZEN inválido.");
  return u.origin;
}
function configureSso(
  app,
  env,
  pool,
  { valid, issueToken, publicUser, checkPassword },
) {
  const loginUrl = origin(env.SSO_LOGIN_URL);
  const apps = {
    zencontrol: loginUrl,
    zenfield: origin(env.TECHNICIAN_PORTAL_URL),
    stock: origin(env.SSO_STOCK_URL),
  };
  const enabled = Boolean(
    loginUrl &&
    apps.zenfield &&
    apps.stock &&
    env.STOCK_API_SECRET?.length >= 32,
  );
  const limited = rateLimit({
    windowMs: 60000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Muitas solicitações de acesso. Aguarde um minuto." },
  });
  const allowed = (role, target) =>
    role === "tecnico"
      ? target === "zenfield"
      : ["admin", "operador"].includes(role) &&
        ["zencontrol", "stock"].includes(target);
  function requireEnabled() {
    if (!enabled) fail(503, "Acesso único não configurado.");
  }
  function backchannel(req) {
    requireEnabled();
    if (!equal(req.headers["x-zen-sso-secret"], env.STOCK_API_SECRET))
      fail(401, "Integração de identidade não autorizada.");
  }
  async function activeRow(id, version) {
    const row = (
      await pool.query(
        "SELECT * FROM usuarios WHERE id=$1 AND ativo=true AND activation_required=false",
        [id],
      )
    ).rows[0];
    if (!row || row.versao_sessao !== version)
      fail(401, "Sua sessão expirou. Entre novamente.");
    if (
      row.papel === "tecnico" &&
      !(
        await pool.query(
          "SELECT 1 FROM zc_technician_accounts a JOIN zc_technicians t ON t.id=a.technician_id WHERE a.user_id=$1 AND t.active=true",
          [id],
        )
      ).rowCount
    )
      fail(403, "Cadastro técnico inativo.");
    return row;
  }
  async function stockIdentity(req) {
    backchannel(req);
    if (
      typeof req.body.token !== "string" ||
      !/^zen_sso_[A-Za-z0-9_-]{43}$/.test(req.body.token)
    )
      fail(401, "Sessão inválida.");
    const grant = (
      await pool.query(
        "SELECT * FROM zc_sso_grants WHERE token_hash=$1 AND expires_at>now()",
        [digest(req.body.token)],
      )
    ).rows[0];
    if (!grant) fail(401, "Sua sessão expirou. Entre novamente.");
    const row = await activeRow(grant.user_id, grant.session_version);
    if (!allowed(row.papel, "stock"))
      fail(403, "Esta conta não tem acesso ao estoque.");
    return row;
  }
  app.get("/api/auth/config", (req, res) =>
    res.json({
      unified_login: enabled,
      login_url: enabled ? loginUrl : "",
      apps: enabled ? apps : {},
    }),
  );
  app.post("/api/auth/sso/code", limited, async (req, res) => {
    requireEnabled();
    const user = await valid(req);
    if (!user) fail(401, "Entre na sua conta ZEN.");
    const { app: target, challenge, state } = req.body;
    if (!Object.hasOwn(apps, target) || !allowed(user.papel, target))
      fail(403, "Perfil sem acesso a este aplicativo.");
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(challenge || "") ||
      !/^[A-Za-z0-9_-]{32,100}$/.test(state || "")
    )
      fail(400, "Inicie o acesso pelo aplicativo de destino.");
    const row = (
      await pool.query("SELECT versao_sessao FROM usuarios WHERE id=$1", [
        user.id,
      ])
    ).rows[0];
    const sessionVersion = JSON.parse(
      Buffer.from(
        req.headers.authorization.replace(/^Bearer /, "").split(".")[0],
        "base64url",
      ).toString(),
    ).version;
    if (row?.versao_sessao !== sessionVersion)
      fail(401, "Sua sessão expirou. Entre novamente.");
    const code = randomBytes(32).toString("base64url");
    await transaction(pool, async (tx) => {
      await tx.query("DELETE FROM zc_sso_codes WHERE expires_at<=now()");
      await tx.query("DELETE FROM zc_sso_grants WHERE expires_at<=now()");
      await tx.query(
        "INSERT INTO zc_sso_codes(code_hash,user_id,session_version,app,challenge,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '60 seconds')",
        [digest(code), user.id, row.versao_sessao, target, challenge, state],
      );
    });
    const url = new URL(apps[target]);
    url.hash = new URLSearchParams({ zen_code: code, state }).toString();
    res.json({ redirect_url: url.href });
  });
  app.post("/api/auth/sso/exchange", limited, async (req, res) => {
    requireEnabled();
    const { app: target, code, verifier, state } = req.body;
    if (!Object.hasOwn(apps, target)) fail(400, "Aplicativo inválido.");
    if (target === "stock") backchannel(req);
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(code || "") ||
      !/^[A-Za-z0-9_-]{43,100}$/.test(verifier || "") ||
      !/^[A-Za-z0-9_-]{32,100}$/.test(state || "")
    )
      fail(401, "Acesso inválido. Inicie novamente.");
    const grantToken = "zen_sso_" + randomBytes(32).toString("base64url");
    const row = await transaction(pool, async (tx) => {
      const ticket = (
        await tx.query(
          "SELECT * FROM zc_sso_codes WHERE code_hash=$1 AND expires_at>now() FOR UPDATE",
          [digest(code)],
        )
      ).rows[0];
      if (
        !ticket ||
        ticket.app !== target ||
        !equal(ticket.challenge, challengeFor(verifier)) ||
        !equal(ticket.state, state)
      )
        fail(401, "Acesso inválido ou expirado. Inicie novamente.");
      // Read current permissions within the same transaction that consumes the code.
      const row = (
        await tx.query(
          "SELECT * FROM usuarios WHERE id=$1 AND ativo=true AND activation_required=false FOR SHARE",
          [ticket.user_id],
        )
      ).rows[0];
      if (
        !row ||
        row.versao_sessao !== ticket.session_version ||
        !allowed(row.papel, target)
      )
        fail(403, "Permissão de acesso alterada. Entre novamente.");
      if (
        row.papel === "tecnico" &&
        !(
          await tx.query(
            "SELECT 1 FROM zc_technician_accounts a JOIN zc_technicians t ON t.id=a.technician_id WHERE a.user_id=$1 AND t.active=true",
            [row.id],
          )
        ).rowCount
      )
        fail(403, "Cadastro técnico inativo.");
      await tx.query("DELETE FROM zc_sso_codes WHERE code_hash=$1", [
        ticket.code_hash,
      ]);
      if (target === "stock")
        await tx.query(
          "INSERT INTO zc_sso_grants(token_hash,user_id,session_version,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
          [digest(grantToken), row.id, row.versao_sessao],
        );
      return row;
    });
    res.json({
      enabled: true,
      authenticated: true,
      api_version: "6.4.0",
      user: publicUser(row),
      ...(target === "stock" ? { token: grantToken } : issueToken(row)),
    });
  });
  app.post("/api/auth/sso/validate", async (req, res) =>
    res.json({ user: publicUser(await stockIdentity(req)) }),
  );
  app.post("/api/auth/sso/reauth", limited, async (req, res) => {
    const row = await stockIdentity(req);
    if (
      row.papel !== "admin" ||
      !(await checkPassword(req.body.password, row.senha_hash))
    )
      fail(403, "A senha atual não confere.");
    res.json({ ok: true });
  });
  app.post("/api/auth/sso/logout", async (req, res) => {
    const row = await stockIdentity(req);
    await pool.query(
      "UPDATE usuarios SET versao_sessao=versao_sessao+1 WHERE id=$1",
      [row.id],
    );
    res.json({ ok: true });
  });
  app.post("/api/auth/logout", async (req, res) => {
    const user = await valid(req);
    if (user?.id)
      await pool.query(
        "UPDATE usuarios SET versao_sessao=versao_sessao+1 WHERE id=$1",
        [user.id],
      );
    res.json({ ok: true });
  });
  return { enabled };
}
module.exports = { configureSso };
