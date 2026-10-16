const path = require("node:path");
const ROOT = path.resolve(__dirname, "../../..");
const { validateMediaConfig } = require("./media-store");
require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
const yes = (v) =>
  ["1", "true", "yes", "sim"].includes(String(v).toLowerCase());
function configuration(env = process.env) {
  if (!env.APP_PASSWORD || env.APP_PASSWORD.length < 12)
    throw Error("Configure APP_PASSWORD com pelo menos 12 caracteres.");
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw Error("Configure SESSION_SECRET com pelo menos 32 caracteres.");
  if (!env.ZEN_WEBHOOK_SECRET || env.ZEN_WEBHOOK_SECRET.length < 32)
    throw Error("Configure ZEN_WEBHOOK_SECRET com pelo menos 32 caracteres.");
  if (yes(env.STOCK_ENABLED)) {
    if (!env.STOCK_API_SECRET || env.STOCK_API_SECRET.length < 32)
      throw Error("Configure STOCK_API_SECRET com pelo menos 32 caracteres.");
    let url;
    try {
      url = new URL(env.STOCK_API_URL);
    } catch {
      throw Error("Configure STOCK_API_URL com a URL do Estoque Pro.");
    }
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "estoque-pro"].includes(url.hostname)
      )
    )
      throw Error("Use HTTPS para a integração com o Estoque Pro.");
    if (url.username || url.password || url.search || url.hash)
      throw Error("URL do Estoque Pro inválida.");
  }
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(env.STOCK_SOURCE_SYSTEM || "zencontrol"))
    throw Error("STOCK_SOURCE_SYSTEM inválido.");
  if (env.TECHNICIAN_PORTAL_URL) {
    let url;
    try {
      url = new URL(env.TECHNICIAN_PORTAL_URL);
    } catch {}
    if (
      !url ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw Error(
        "TECHNICIAN_PORTAL_URL deve ser a URL HTTPS da raiz do portal (HTTP permitido apenas em localhost).",
      );
  }
  validateMediaConfig(env);
  return {
    ...env,
    TECHNICIAN_PORTAL_URL: (env.TECHNICIAN_PORTAL_URL || "").replace(/\/$/, ""),
    ROOT,
    DATA_DIR: path.resolve(ROOT, env.ZEN_DATA_DIR || "data"),
    INTEGRATIONS_ENABLED: yes(env.INTEGRATIONS_ENABLED),
    AUTO_CLOSE_ENABLED: yes(env.AUTO_CLOSE_ENABLED),
    SGA_SYNC_ENABLED: yes(env.SGA_SYNC_ENABLED),
    RUN_WORKER: yes(env.ZEN_RUN_WORKER),
    STOCK_ENABLED: yes(env.STOCK_ENABLED),
    STOCK_API_URL: env.STOCK_API_URL || "",
    STOCK_API_SECRET: env.STOCK_API_SECRET || "",
    STOCK_SOURCE_SYSTEM: env.STOCK_SOURCE_SYSTEM || "zencontrol",
    WPP_API_URL: env.WPP_API_URL || "http://127.0.0.1:21465/api",
    WPP_SESSION: env.WPP_SESSION || "ZenSeguros",
    HINOVA_API_URL:
      env.HINOVA_API_URL || "https://api.hinova.com.br/api/sga/v2",
    PUBLIC_URL: (env.ZEN_PUBLIC_URL || "http://127.0.0.1:3000").replace(
      /\/$/,
      "",
    ),
    SGA_SCHEDULED_CODE: env.SGA_SCHEDULED_CODE || "21",
    SGA_COMPLETED_CODE: env.SGA_COMPLETED_CODE || "1",
  };
}
module.exports = { configuration, ROOT };
