const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { OAuth2Client } = require("google-auth-library");
const { rateLimit } = require("express-rate-limit");
const { transaction } = require("./database");
const { fail } = require("./errors");
const { checkPassword } = require("./auth");

const digest = (value) =>
  createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
const noncePattern = /^[A-Za-z0-9_-]{43}$/;
const roles = ["admin", "operador", "tecnico"];
const googleOrigin = "https://accounts.google.com";

function googleSettings(env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) return null;
  if (!/^[A-Za-z0-9_-]{3,200}\.apps\.googleusercontent\.com$/.test(clientId))
    throw Error("Configure GOOGLE_CLIENT_ID com um cliente Web do Google.");
  if (!env.SSO_LOGIN_URL)
    throw Error("O acesso Google exige SSO_LOGIN_URL do ZenTracking.");
  const central = new URL(env.SSO_LOGIN_URL).origin;
  const field = env.TECHNICIAN_PORTAL_URL
    ? new URL(env.TECHNICIAN_PORTAL_URL).origin
    : null;
  return { clientId, central, field };
}

function googleLimiter() {
  return rateLimit({
    windowMs: 15 * 60000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Muitas tentativas. Aguarde antes de tentar novamente." },
  });
}

async function requireAccountPassword(db, userId, password) {
  if (typeof password !== "string" || password.length > 256)
    fail(400, "Informe a senha atual.");
  const row = (
    await db.query(
      "SELECT senha_hash FROM usuarios WHERE id=$1 AND ativo=true AND activation_required=false",
      [userId],
    )
  ).rows[0];
  if (!(await checkPassword(password, row?.senha_hash)))
    fail(403, "A senha atual não confere.");
}

async function activeAccount(db, id) {
  const row = (
    await db.query(
      "SELECT * FROM usuarios WHERE id=$1 AND ativo=true AND activation_required=false FOR SHARE",
      [id],
    )
  ).rows[0];
  if (!row || !roles.includes(row.papel))
    fail(403, "Esta conta não está disponível. Procure a central.");
  if (
    row.papel === "tecnico" &&
    !(
      await db.query(
        "SELECT 1 FROM zc_technician_accounts a JOIN zc_technicians t ON t.id=a.technician_id WHERE a.user_id=$1 AND t.active=true",
        [row.id],
      )
    ).rowCount
  )
    fail(403, "Cadastro técnico inativo.");
  return row;
}

function configureGoogleAccess(app, env, pool, auth) {
  const settings = googleSettings(env);
  if (!settings) return {};
  const { clientId, central, field } = settings;
  const oauth = new OAuth2Client({ clientId });
  const limited = googleLimiter();
  function requestOrigin(req, intent) {
    const origin = req.get("Origin");
    if (origin !== central && !(intent === "link" && field && origin === field))
      fail(403, "Abra o acesso Google no endereço oficial do ZenTracking.");
    return origin;
  }
  async function identify(req, intent) {
    if (intent === "login") return { userId: null, sessionHash: null };
    const user = await auth.valid(req);
    if (!user?.id) fail(401, "Entre na sua conta para vincular o Google.");
    return { userId: user.id, sessionHash: digest(req.get("Authorization")) };
  }
  function inputIntent(req) {
    const intent = req.body.intent;
    if (!["login", "link"].includes(intent))
      fail(400, "Acesso Google inválido.");
    return intent;
  }

  app.post("/api/auth/google/challenge", limited, async (req, res) => {
    const intent = inputIntent(req);
    const origin = requestOrigin(req, intent);
    const { userId, sessionHash } = await identify(req, intent);
    if (userId) await requireAccountPassword(pool, userId, req.body.password);
    const nonce = randomBytes(32).toString("base64url");
    await transaction(pool, async (db) => {
      await db.query(
        "DELETE FROM zc_google_challenges WHERE expires_at<=now()",
      );
      await db.query(
        "INSERT INTO zc_google_challenges(nonce_hash,intent,origin,user_id,session_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes')",
        [digest(nonce), intent, origin, userId, sessionHash],
      );
    });
    res.json({ nonce });
  });

  app.post("/api/auth/google/complete", limited, async (req, res) => {
    const intent = inputIntent(req);
    const origin = requestOrigin(req, intent);
    const { userId, sessionHash } = await identify(req, intent);
    const { nonce, credential } = req.body;
    if (
      typeof nonce !== "string" ||
      !noncePattern.test(nonce) ||
      typeof credential !== "string" ||
      credential.length > 12000 ||
      !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(credential)
    )
      fail(400, "Resposta do Google inválida. Tente novamente.");
    const nonceHash = digest(nonce);
    const challenge = (
      await pool.query(
        "SELECT * FROM zc_google_challenges WHERE nonce_hash=$1 AND expires_at>now()",
        [nonceHash],
      )
    ).rows[0];
    const matches = (c) =>
      c?.intent === intent &&
      c.origin === origin &&
      c.user_id === userId &&
      c.session_hash === sessionHash;
    if (!matches(challenge))
      fail(401, "Acesso Google expirado. Tente novamente.");
    let profile;
    try {
      const ticket = await oauth.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
      profile = ticket.getPayload();
    } catch {
      fail(
        401,
        "Não foi possível confirmar sua conta Google. Tente novamente.",
      );
    }
    if (
      profile?.nonce !== nonce ||
      profile.email_verified !== true ||
      typeof profile.sub !== "string" ||
      !/^[A-Za-z0-9_-]{1,255}$/.test(profile.sub) ||
      typeof profile.email !== "string" ||
      profile.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+$/.test(profile.email) ||
      (profile.azp && profile.azp !== clientId)
    )
      fail(401, "A conta Google não pôde ser confirmada.");
    const used = (
      await pool.query(
        "DELETE FROM zc_google_challenges WHERE nonce_hash=$1 AND expires_at>now() RETURNING *",
        [nonceHash],
      )
    ).rows[0];
    if (!matches(used)) fail(401, "Acesso Google expirado. Tente novamente.");
    const account = await transaction(pool, async (db) => {
      if (intent === "link") {
        await activeAccount(db, userId);
        // A password reset, logout or deactivation invalidates the session used to link.
        const session = await auth.valid(req, db);
        if (session?.id !== userId) fail(401, "Entre novamente para vincular.");
        const linked = await db.query(
          "INSERT INTO zc_google_accounts(user_id,subject,email) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id",
          [userId, profile.sub, profile.email],
        );
        if (!linked.rowCount)
          fail(409, "Esta conta Google ou este perfil já possui um vínculo.");
        await db.query(
          "INSERT INTO zc_auth_events(id,user_id,event) VALUES($1,$2,'google_linked')",
          [randomUUID(), userId],
        );
        return null;
      }
      const linked = (
        await db.query(
          "SELECT user_id FROM zc_google_accounts WHERE subject=$1 FOR SHARE",
          [profile.sub],
        )
      ).rows[0];
      if (!linked)
        fail(
          403,
          "Entre com usuário e senha e vincule sua conta Google em Meu perfil.",
        );
      const row = await activeAccount(db, linked.user_id);
      await db.query(
        "INSERT INTO zc_auth_events(id,user_id,event) VALUES($1,$2,'google_login_succeeded')",
        [randomUUID(), row.id],
      );
      return row;
    });
    if (!account) return res.json({ linked: true });
    res.json({
      enabled: true,
      authenticated: true,
      api_version: "6.4.0",
      user: auth.publicUser(account),
      ...auth.issueToken(account),
    });
  });
  return { googleClientId: clientId };
}

module.exports = {
  configureGoogleAccess,
  googleSettings,
  googleOrigin,
  googleLimiter,
  requireAccountPassword,
};
