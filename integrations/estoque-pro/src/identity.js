const { randomUUID } = require("node:crypto");
const { fail } = require("./errors");
function identity(env, pool, publicUser) {
  const enabled = Boolean(env.ZEN_IDENTITY_API_URL);
  let base;
  if (enabled) {
    let u;
    try {
      u = new URL(env.ZEN_IDENTITY_API_URL);
    } catch {
      throw Error("ZEN_IDENTITY_API_URL inválida.");
    }
    if (
      (u.protocol !== "https:" &&
        !(
          u.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(u.hostname)
        )) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/"
    )
      throw Error("Use uma origem HTTPS válida em ZEN_IDENTITY_API_URL.");
    if (
      env.ZENCONTROL_INTEGRATION_SECRET?.length < 32 ||
      !env.ZENCONTROL_INTEGRATION_SECRET
    )
      throw Error("Configure o segredo da integração de identidade.");
    base = u.origin;
  }
  async function remote(action, body) {
    let r;
    try {
      r = await fetch(base + "/api/auth/sso/" + action, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-zen-sso-secret": env.ZENCONTROL_INTEGRATION_SECRET,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
    } catch {
      fail(
        503,
        "A conta ZEN está temporariamente indisponível. Tente novamente.",
      );
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
      fail(
        r.status === 401 || r.status === 403 ? r.status : 503,
        data.error || "Não foi possível validar a conta ZEN.",
      );
    return data;
  }
  async function localUser(user) {
    if (
      !user?.ativo ||
      !Number.isSafeInteger(user.id) ||
      !["admin", "operador"].includes(user.papel)
    )
      fail(403, "Esta conta não tem acesso ao Estoque Pro.");
    const result = await pool.query(
      `INSERT INTO usuarios(login,nome,senha_hash,papel,zen_identity_id)
    VALUES($1,$2,'external-identity-only',$3,$4) ON CONFLICT(zen_identity_id) DO UPDATE
    SET nome=EXCLUDED.nome,papel=EXCLUDED.papel,ativo=true RETURNING *`,
      [
        "zen." + randomUUID().replaceAll("-", ""),
        user.nome,
        user.papel,
        user.id,
      ],
    );
    return {
      ...publicUser(result.rows[0]),
      login: user.login,
      identity_provider: "zen",
      identity_id: user.id,
    };
  }
  const token = (req) =>
    (req.headers.authorization || "").replace(/^Bearer /, "");
  return {
    enabled,
    async valid(req) {
      if (!/^zen_sso_[A-Za-z0-9_-]{43}$/.test(token(req))) return null;
      try {
        return await localUser(
          (await remote("validate", { token: token(req) })).user,
        );
      } catch (e) {
        if ([401, 403].includes(e.status || e.statusCode)) return null;
        throw e;
      }
    },
    async exchange(body) {
      const data = await remote("exchange", {
        app: "stock",
        code: body.code,
        state: body.state,
        verifier: body.verifier,
      });
      return { ...data, user: await localUser(data.user) };
    },
    reauthenticate: (req) =>
      remote("reauth", { token: token(req), password: req.body.password }),
    logout: (req) => remote("logout", { token: token(req) }),
  };
}
module.exports = { identity };
