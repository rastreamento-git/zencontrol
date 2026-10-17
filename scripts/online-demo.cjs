/* Temporary online demonstration only. Never connects to a remote database. */
const http = require("node:http");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");

function configuration(env) {
  if (env.RENDER !== "true")
    throw Error("O modo online-demo exige execução no Render.");
  for (const key of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "STOCK_API_URL",
  ])
    if (env[key])
      throw Error(
        `Remova ${key}: a demonstração não aceita conexões externas.`,
      );
  if (!env.ONLINE_DEMO_PASSWORD || env.ONLINE_DEMO_PASSWORD.length < 16)
    throw Error("Configure ONLINE_DEMO_PASSWORD com pelo menos 16 caracteres.");
  if (!env.ONLINE_DEMO_SECRET || env.ONLINE_DEMO_SECRET.length < 32)
    throw Error("Configure ONLINE_DEMO_SECRET com pelo menos 32 caracteres.");
  const origin = (value) => {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/"
    )
      throw Error(
        "Os endereços públicos da demonstração precisam ser origens HTTPS.",
      );
    return u.origin;
  };
  const port = Number(env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("PORT inválida.");
  return {
    publicOrigin: origin(env.RENDER_EXTERNAL_URL),
    fieldOrigin: origin(env.ONLINE_FIELD_URL),
    stockOrigin: origin(env.ONLINE_STOCK_URL),
    adminPassword: env.ONLINE_DEMO_PASSWORD,
    secret: env.ONLINE_DEMO_SECRET,
    port,
  };
}

function proxy(port, strip = "") {
  return (req, res) => {
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    delete headers.connection;
    delete headers["proxy-authorization"];
    headers["x-forwarded-for"] = req.ip;
    headers["x-forwarded-proto"] = req.protocol;
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: req.method,
        path: req.originalUrl.slice(strip.length) || "/",
        headers,
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.setTimeout(90000, () => upstream.destroy());
    upstream.on("error", () => {
      if (res.headersSent) return res.destroy();
      res
        .status(503)
        .json({
          error: "Demonstração temporariamente indisponível. Tente novamente.",
        });
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  };
}

function gateway({ fixtures, config }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { scriptSrc: ["'self'", "'wasm-unsafe-eval'"] },
      },
    }),
  );
  app.use((req, res, next) => {
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    next();
  });
  app.get("/demo-info", (req, res) =>
    res.json({
      mode: "online-demo",
      ephemeral: true,
      warning:
        "Somente dados fictícios. Reinícios e suspensão apagam alterações e recriam os exemplos.",
      field: config.fieldOrigin,
      stock: config.stockOrigin,
    }),
  );
  app.use("/demo-files", express.static(fixtures, { dotfiles: "deny" }));
  app.use("/stock-api", proxy(4318, "/stock-api"));
  app.use(proxy(4317));
  return app;
}

function banner(directory) {
  const fs = require("node:fs");
  const file = path.join(directory, "index.html");
  let html = fs.readFileSync(file, "utf8");
  if (html.includes('id="online-demo-notice"')) return;
  const notice =
    '<aside id="online-demo-notice" role="status" style="position:relative;z-index:9999;background:#fff0c2;color:#493600;padding:10px 14px;text-align:center;font:600 13px/1.45 system-ui">HOMOLOGAÇÃO TEMPORÁRIA · Use dados fictícios. Reinícios apagam alterações e recriam os exemplos. Baixe um backup antes de encerrar.</aside>';
  html = html
    .replace(/<body([^>]*)>/i, `<body$1>${notice}`)
    .replace(/<title>([^<]*)<\/title>/i, "<title>TESTE — $1</title>");
  fs.writeFileSync(file, html);
}

module.exports = { configuration, gateway, banner };
if (require.main === module && process.argv[2] === "banner")
  banner(process.argv[3]);
