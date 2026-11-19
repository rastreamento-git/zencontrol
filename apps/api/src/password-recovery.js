const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { rateLimit } = require("express-rate-limit");
const { hashPassword } = require("./auth");
const { transaction } = require("./database");
const { fail } = require("./errors");

const hash = (value) => createHash("sha256").update(value).digest("hex");
const eligible = `u.ativo=true AND (u.papel<>'tecnico' OR EXISTS (
  SELECT 1 FROM zc_technician_accounts a JOIN zc_technicians t ON t.id=a.technician_id
  WHERE a.user_id=u.id AND t.active=true
))`;

function recoveryEmail(value) {
  if (value === null || (typeof value === "string" && !value.trim()))
    return null;
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    email.length > 254 ||
    !/^[^\s@<>]+@[a-z0-9.-]+\.[a-z0-9-]{2,}$/i.test(email)
  )
    fail(400, "Informe um e-mail de recuperação válido.");
  return email;
}

function mailSettings(cfg) {
  if (
    !cfg.APP_PASSWORD ||
    !cfg.RESEND_API_KEY?.trim() ||
    !cfg.PASSWORD_RESET_FROM?.trim()
  )
    return null;
  const url = new URL(cfg.SSO_LOGIN_URL || cfg.PUBLIC_URL);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        cfg.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)
      ))
  )
    throw Error(
      "A recuperação de senha exige uma URL HTTPS válida do ZenTracking.",
    );
  return {
    origin: url.origin,
    async send(to, subject, text, html) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + cfg.RESEND_API_KEY.trim(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: cfg.PASSWORD_RESET_FROM.trim(),
          to: [to],
          subject,
          text,
          html,
        }),
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (!response.ok) throw Error("Falha do serviço de e-mail");
      await response.body?.cancel();
    },
  };
}

function configurePasswordRecovery(app, pool, cfg) {
  const mail = mailSettings(cfg);
  const limiter = (limit) =>
    rateLimit({
      windowMs: 15 * 60000,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: "Muitas tentativas. Tente novamente em alguns minutos.",
      },
    });
  const reportFailure = () =>
    console.error("Falha no serviço de recuperação de senha.");

  async function sendLink(identifier) {
    const token = randomBytes(32).toString("base64url");
    const field = identifier.includes("@") ? "recovery_email" : "login";
    const { rows } = await pool.query(
      `INSERT INTO zc_password_resets(user_id,token_hash,user_version,expires_at)
       SELECT u.id,$2,u.versao_sessao,now()+interval '30 minutes'
       FROM usuarios u WHERE u.${field}=$1 AND u.recovery_email IS NOT NULL AND ${eligible}
       ON CONFLICT(user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,
         user_version=EXCLUDED.user_version,expires_at=EXCLUDED.expires_at,
         created_at=now(),used_at=NULL
       WHERE zc_password_resets.created_at <= now()-interval '2 minutes'
       RETURNING user_id,user_version`,
      [identifier, hash(token)],
    );
    if (!rows[0]) return;
    const { rows: accounts } = await pool.query(
      "SELECT recovery_email FROM usuarios WHERE id=$1 AND versao_sessao=$2 AND ativo=true",
      [rows[0].user_id, rows[0].user_version],
    );
    if (!accounts[0]?.recovery_email) return;
    const url = new URL("/", mail.origin);
    url.hash = new URLSearchParams({ redefinir: token }).toString();
    const text =
      "Abra o link para definir uma nova senha no ZenTracking. Ele vale por 30 minutos. Se você não fez o pedido, ignore este e-mail.";
    await mail.send(
      accounts[0].recovery_email,
      "Redefina sua senha do ZenTracking",
      text + "\n\n" + url.href,
      `<p>${text}</p><p><a href="${url.href}">Definir nova senha</a></p>`,
    );
  }
  app.post("/api/auth/password/forgot", limiter(6), (req, res) => {
    if (!mail)
      fail(
        503,
        "A recuperação por e-mail está indisponível. Fale com a central.",
      );
    const identifier =
      typeof req.body.identifier === "string"
        ? req.body.identifier.trim().toLowerCase()
        : "";
    res
      .status(202)
      .json({
        message:
          "Se houver uma conta ativa com e-mail cadastrado, enviaremos o link de redefinição.",
      });
    if (identifier && identifier.length <= 254)
      void sendLink(identifier).catch(reportFailure);
  });
  app.post("/api/auth/password/reset", limiter(10), async (req, res) => {
    const token = req.body.token;
    const invalid = () =>
      fail(
        400,
        "Link inválido ou expirado. Solicite um novo link de redefinição.",
      );
    if (
      !cfg.APP_PASSWORD ||
      typeof token !== "string" ||
      !/^[a-zA-Z0-9_-]{43}$/.test(token)
    )
      invalid();
    const digest = hash(token);
    const lookup = `SELECT u.id,u.recovery_email FROM zc_password_resets p JOIN usuarios u ON u.id=p.user_id
       WHERE p.token_hash=$1 AND p.used_at IS NULL AND p.expires_at>now()
         AND p.user_version=u.versao_sessao AND u.recovery_email IS NOT NULL AND ${eligible}`;
    if (!(await pool.query(lookup, [digest])).rowCount) invalid();
    const nextHash = await hashPassword(req.body.new_password);
    const email = await transaction(pool, async (db) => {
      const {
        rows: [account],
      } = await db.query(lookup + " FOR UPDATE OF p,u", [digest]);
      if (!account) invalid();
      await db.query(
        "UPDATE usuarios SET senha_hash=$1,activation_required=false,versao_sessao=versao_sessao+1 WHERE id=$2",
        [nextHash, account.id],
      );
      await db.query(
        "UPDATE zc_password_resets SET used_at=now() WHERE user_id=$1",
        [account.id],
      );
      await db.query(
        "UPDATE zc_activations SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [account.id],
      );
      await db.query(
        "INSERT INTO zc_auth_events(id,user_id,event) VALUES($1,$2,'password_reset')",
        [randomUUID(), account.id],
      );
      return account.recovery_email;
    });
    res.json({ ok: true });
    if (mail)
      void mail
        .send(
          email,
          "Sua senha do ZenTracking foi alterada",
          "A senha da sua conta foi redefinida. Se você não fez essa alteração, fale com a central.",
        )
        .catch(reportFailure);
  });
}

module.exports = { configurePasswordRecovery, recoveryEmail };
