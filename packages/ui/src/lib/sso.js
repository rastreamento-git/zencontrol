import { appearanceUrl } from "./appearance";
import { api, saveToken } from "./api";
let preparation;
let routing;
const bytes = (size) => {
  const data = crypto.getRandomValues(new Uint8Array(size));
  return btoa(String.fromCharCode(...data))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};
async function challenge(value) {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return btoa(String.fromCharCode(...hash))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export async function beginLogin(app, config) {
  if (!config.login_url)
    throw Error("Acesso único indisponível. Procure a central.");
  const verifier = bytes(32),
    state = bytes(24);
  sessionStorage.setItem(
    "zen.access." + app,
    JSON.stringify({ verifier, state, created: Date.now() }),
  );
  const url = new URL(config.login_url);
  url.search = new URLSearchParams({
    zen_app: app,
    zen_state: state,
    zen_challenge: await challenge(verifier),
  }).toString();
  window.location.replace(appearanceUrl(url.href));
}
export function prepareAccess(app) {
  if (!preparation)
    preparation = (async () => {
      const { data: config } = await api.get("/auth/config");
      if (!config.unified_login) return config;
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      if (fragment.has("zen_code")) {
        history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
        let proof;
        try {
          proof = JSON.parse(sessionStorage.getItem("zen.access." + app));
        } catch {}
        sessionStorage.removeItem("zen.access." + app);
        if (
          !proof ||
          proof.state !== fragment.get("state") ||
          !Number.isFinite(proof.created) ||
          Date.now() - proof.created > 5 * 60000
        )
          throw Error(
            "Este acesso expirou ou foi aberto em outra aba. Use Entrar no ZenTracking novamente.",
          );
        const { data } = await api.post("/auth/sso/exchange", {
          app,
          code: fragment.get("zen_code"),
          state: proof.state,
          verifier: proof.verifier,
        });
        saveToken(data.token);
      }
      if (
        app !== "zencontrol" &&
        new URLSearchParams(window.location.search).get("zen_login") === "1"
      ) {
        history.replaceState(null, "", window.location.pathname);
        await beginLogin(app, config);
        return { ...config, redirecting: true };
      }
      return config;
    })().catch((e) => {
      preparation = null;
      throw e;
    });
  return preparation;
}
export async function routeSession(data, current, config) {
  if (!config?.unified_login || !data.user) return false;
  const technical = data.user.papel === "tecnico";
  const allowed = technical
    ? ["zenfield"]
    : ["zencontrol", "zenfield", "stock"];
  const query = new URLSearchParams(window.location.search);
  const target = query.get("zen_app");
  if (
    current === "zencontrol" &&
    target &&
    allowed.includes(target) &&
    query.get("zen_state") &&
    query.get("zen_challenge")
  ) {
    if (!routing)
      routing = (async () => {
        const { data: ticket } = await api.post("/auth/sso/code", {
          app: target,
          state: query.get("zen_state"),
          challenge: query.get("zen_challenge"),
        });
        history.replaceState(null, "", window.location.pathname);
        window.location.replace(appearanceUrl(ticket.redirect_url));
      })().catch((e) => {
        routing = null;
        throw e;
      });
    await routing;
    return true;
  }
  const destination = technical ? "zenfield" : current;
  if (current !== destination) {
    const url = new URL(config.apps[destination]);
    url.searchParams.set("zen_login", "1");
    window.location.replace(appearanceUrl(url.href));
    return true;
  }
  if (target) history.replaceState(null, "", window.location.pathname);
  return false;
}
export async function openApp(app) {
  const { data: config } = await api.get("/auth/config");
  const url = new URL(config.apps[app]);
  url.searchParams.set("zen_login", "1");
  window.location.assign(appearanceUrl(url.href));
}
