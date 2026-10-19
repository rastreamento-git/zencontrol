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
    centralOrigin: origin(env.ONLINE_CENTRAL_URL || env.RENDER_EXTERNAL_URL),
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
      res.status(503).json({
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

async function database(directory, secret) {
  const fs = require("node:fs/promises");
  const { pathToFileURL } = require("node:url");
  const { createHmac } = require("node:crypto");
  const { Pool } = require("pg");
  // A native server avoids the WASM compiler's >512 MiB transient peak.
  // Do not create OS accounts or change host permissions.
  if (process.getuid?.() === 0)
    throw Error(
      "A demonstração PostgreSQL exige um processo sem privilégios root.",
    );
  const modulePath = require.resolve("embedded-postgres", {
    paths: [path.join(__dirname, "../.homologation-build/runtime")],
  });
  const EmbeddedPostgres = (await import(pathToFileURL(modulePath).href))
    .default;
  const password = createHmac("sha256", secret)
    .update("postgres-demo")
    .digest("hex");
  const databaseDir = path.join(directory, "native-postgres");
  const server = new EmbeddedPostgres({
    databaseDir,
    user: "zen_demo",
    password,
    port: 54321,
    authMethod: "scram-sha-256",
    persistent: true,
    createPostgresUser: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: [
      "-h",
      "127.0.0.1",
      "-c",
      "shared_buffers=16MB",
      "-c",
      "max_connections=20",
      "-c",
      "work_mem=1MB",
      "-c",
      "maintenance_work_mem=8MB",
      "-c",
      "max_worker_processes=2",
      "-c",
      "max_parallel_workers=0",
    ],
    onLog: () => {},
    onError: () => console.error("Falha no PostgreSQL temporário."),
  });
  try {
    await fs.access(path.join(databaseDir, "PG_VERSION"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const mask = process.umask(0o077);
    try {
      await server.initialise();
    } finally {
      process.umask(mask);
    }
  }
  await server.start();
  const admin = server.getPgClient("postgres", "127.0.0.1");
  const pools = [];
  try {
    await admin.connect();
    for (const name of ["zencontrol_demo", "stock_demo"]) {
      if (
        !(
          await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
            name,
          ])
        ).rowCount
      )
        await admin.query(`CREATE DATABASE "${name}"`);
      const pool = new Pool({
        host: "127.0.0.1",
        port: 54321,
        user: "zen_demo",
        password,
        database: name,
        max: 3,
        ssl: false,
        connectionTimeoutMillis: 10000,
        options:
          "-c timezone=America/Sao_Paulo -c statement_timeout=15000 -c lock_timeout=10000",
      });
      pool.on("error", () =>
        console.error("Falha em conexão local da demonstração."),
      );
      pools.push(pool);
    }
  } catch (error) {
    await Promise.all(pools.map((pool) => pool.end()));
    await server.stop();
    throw error;
  } finally {
    await admin.end();
  }
  return {
    central: { pool: pools[0], close: () => pools[0].end() },
    stock: { pool: pools[1], close: () => pools[1].end() },
    close: () => server.stop(),
  };
}

module.exports = { configuration, gateway, banner, database };
if (require.main === module && process.argv[2] === "banner")
  banner(process.argv[3]);
