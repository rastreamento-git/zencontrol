/* One local process, three independent applications, two isolated PostgreSQL engines.
 * No production configuration, external databases, SGA, WhatsApp or banking services.
 */
const path = require("node:path"),
  fs = require("node:fs/promises"),
  { randomBytes, createHmac } = require("node:crypto"),
  { once } = require("node:events");
const root = path.resolve(__dirname, ".."),
  workspace = path.dirname(root),
  instance = process.env.ZEN_HOMOLOGY_INSTANCE || "";
const online = process.env.ZEN_HOMOLOGATION_MODE === "online-demo";
const onlineConfig = online
  ? require("./online-demo.cjs").configuration(process.env)
  : null;
if (instance && !/^[a-zA-Z0-9_-]{1,64}$/.test(instance))
  throw Error("Nome de instância inválido.");
const dataDir = online
  ? path.join(
      require("node:os").tmpdir(),
      "zen-homologation-" + (instance || "online-demo"),
    )
  : path.join(root, ".homologation" + (instance ? "-" + instance : ""));
const { localDatabase } = require("./local-database.cjs");
const { transaction } = require("../apps/api/src/database"),
  { migrate } = require("../apps/api/scripts/migrate"),
  { createApp } = require("../apps/api/src/app");
const d = require("../apps/api/src/domain"),
  o = require("../apps/api/src/orders"),
  f = require("../apps/api/src/finance-engine"),
  cal = require("../apps/api/src/financial-calendar");
const {
  createTechnicianAccount,
} = require("../apps/api/src/technician-access");
const express = require("express");
async function main() {
  if (
    process.env.DATABASE_URL ||
    process.env.TEST_DATABASE_URL ||
    (!online && process.env.NODE_ENV === "production")
  )
    throw Error(
      "Remova DATABASE_URL/TEST_DATABASE_URL e NODE_ENV=production. Este inicializador só aceita bancos locais próprios.",
    );
  const inventory = path.resolve(
      process.env.ZEN_INVENTORY_REPO ||
        (online
          ? path.join(root, ".homologation-build/inventario-v2")
          : path.join(workspace, "inventario-v2")),
    ),
    field = path.resolve(
      process.env.ZEN_FIELD_REPO || path.join(workspace, "zenfield"),
    );
  await fs.access(path.join(inventory, "invent-back/src/zencontrol.js"));
  if (!online) await fs.access(path.join(field, "dist/index.html"));
  await fs.access(path.join(root, "apps/web/dist/index.html"));
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const pidFile = path.join(dataDir, "running.pid");
  try {
    const pid = Number(await fs.readFile(pidFile, "utf8"));
    try {
      process.kill(pid, 0);
      throw Error("Esta instância já está em execução.");
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await fs.writeFile(pidFile, String(process.pid), { mode: 0o600 });
  const credentialFile = path.join(dataDir, "access.json");
  let credentials;
  try {
    credentials = JSON.parse(await fs.readFile(credentialFile, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    credentials = {
      admin_password: online
        ? onlineConfig.adminPassword
        : "local-" + randomBytes(12).toString("hex"),
      secret: online ? onlineConfig.secret : randomBytes(32).toString("hex"),
    };
    await fs.writeFile(credentialFile, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  }
  const scopedSecret = (purpose) =>
    createHmac("sha256", credentials.secret).update(purpose).digest("hex");
  const sharedDb = online
    ? await require("./online-demo.cjs").database(dataDir, credentials.secret)
    : null;
  const db = online
      ? sharedDb.central
      : await localDatabase(path.join(dataDir, "zencontrol")),
    stockDb = online
      ? sharedDb.stock
      : await localDatabase(path.join(dataDir, "estoque-pro"));
  const stockModule = require(path.join(inventory, "invent-back/src/app")),
    stockMigrate = require(
      path.join(inventory, "invent-back/scripts/migrate"),
    ).migrate,
    move = require(path.join(inventory, "invent-back/src/inventory")).move;
  await migrate(db.pool);
  await stockMigrate(stockDb.pool);
  const servers = [];
  async function listen(app, port) {
    const server = app.listen(port, "127.0.0.1");
    await once(server, "listening");
    servers.push(server);
    return server;
  }
  await listen(
    stockModule.createApp(stockDb.pool, {
      NODE_ENV: online ? "production" : "test",
      APP_PASSWORD: credentials.admin_password,
      SESSION_SECRET: scopedSecret("stock-session"),
      ZENCONTROL_INTEGRATION_SECRET: scopedSecret("stock-integration"),
      CORS_ORIGINS: online ? onlineConfig.stockOrigin : "http://127.0.0.1:4321",
      ...(online ? { TRUST_PROXY: "1" } : {}),
    }),
    4318,
  );
  const app = createApp(db.pool, {
    NODE_ENV: online ? "production" : "test",
    APP_PASSWORD: credentials.admin_password,
    SESSION_SECRET: scopedSecret("central-session"),
    ZEN_WEBHOOK_SECRET: scopedSecret("legacy-webhook"),
    ZEN_PUBLIC_URL: online
      ? onlineConfig.publicOrigin
      : "http://127.0.0.1:4317",
    TECHNICIAN_PORTAL_URL: online
      ? onlineConfig.fieldOrigin
      : "http://127.0.0.1:4319",
    CORS_ORIGINS: online
      ? [onlineConfig.publicOrigin, onlineConfig.fieldOrigin].join(",")
      : "http://127.0.0.1:4319,http://127.0.0.1:4320,http://127.0.0.1:4321",
    ...(online ? { TRUST_PROXY: "1" } : {}),
    ZEN_DATA_DIR: path.join(dataDir, "media-data"),
    STOCK_ENABLED: "true",
    STOCK_API_URL: "http://127.0.0.1:4318",
    STOCK_API_SECRET: scopedSecret("stock-integration"),
    STOCK_SOURCE_SYSTEM: "zen-local-homologation",
    INTEGRATIONS_ENABLED: "false",
    AUTO_CLOSE_ENABLED: "false",
    SGA_SYNC_ENABLED: "false",
  });
  await app.locals.ready();
  if (
    !(await d.one(
      db.pool,
      "SELECT 1 FROM zc_migration_runs WHERE fingerprint='local-demo-v1'",
    ))
  ) {
    const codes = [
      "123456789012345",
      "123456789012346",
      "TAG-HOMO-001",
      "TAG-HOMO-002",
    ];
    const technicians = [];
    for (const name of ["José da Silva Martins", "Maria de Souza Lima"]) {
      const stockTech = (
        await stockDb.pool.query(
          "INSERT INTO tecnicos(nome) VALUES($1) RETURNING id",
          [name + " (fictício)"],
        )
      ).rows[0];
      const t = await transaction(db.pool, async (tx) => {
        const t = await o.insert(tx, "zc_technicians", {
          name,
          stock_technician_id: stockTech.id,
          price_install: 9000,
          price_maintenance: 6000,
          price_removal: 4500,
          price_visit: 3000,
        });
        const access = await createTechnicianAccount(
          tx,
          t,
          "Demonstração local",
        );
        await f.initialRate(tx, t, "Demonstração local");
        credentials[t.id] = {
          name,
          login: access.login,
          activation_code: access.code,
          expires_at: access.expires_at,
          temporary_password: "zen123",
        };
        await tx.query(
          "INSERT INTO zc_closing_policies(technician_id,policy,updated_by) VALUES($1,$2::jsonb,$3)",
          [
            t.id,
            JSON.stringify({
              unit: t.id === 1 ? "weeks" : "days",
              every: t.id === 1 ? 1 : 14,
              anchor: cal.add(d.today(), -28),
              due_days: 2,
              due_business_days: true,
            }),
            "Demonstração local",
          ],
        );
        return t;
      });
      technicians.push(t);
    }
    for (const [i, category] of ["RASTREADOR", "TAG"].entries()) {
      const product = (
        await stockDb.pool.query(
          "INSERT INTO produtos(nome,categoria) VALUES($1,$2) RETURNING id",
          ["Modelo fictício " + category, category],
        )
      ).rows[0];
      await move(stockDb.pool, "entrada", {
        produto_id: product.id,
        seriais: codes.slice(i * 2, i * 2 + 2),
      });
      for (let j = 0; j < 2; j++)
        await move(stockDb.pool, "transferir", {
          produto_id: product.id,
          tecnico_id: technicians[j].stock_technician_id,
          seriais: [codes[i * 2 + j]],
        });
    }
    for (const [i, t] of technicians.entries()) {
      await o.create(
        db.pool,
        {
          customer_name: "Cliente fictício — NÃO ATENDER",
          vehicle: i ? "ZEN2B34" : "ZEN1A23",
          service: "Instalação",
          technician_id: t.id,
          scheduled_at: d.today() + "T14:00",
          location: "Endereço fictício, homologação",
          notes: "Ambiente local. Use os arquivos de demonstração.",
          document_data: { equipment: ["tracker"] },
        },
        "Demonstração local",
      );
      for (let j = 0; j < 3; j++) {
        const day = cal.add(d.today(), -8 - j),
          order = await o.create(
            db.pool,
            {
              customer_name: "Cliente fictício histórico",
              vehicle: "HOM" + i + j + "A23",
              service: "Visita",
              technician_id: t.id,
            },
            "Demonstração local",
          );
        await transaction(db.pool, async (tx) => {
          await f.capture(tx, order, day);
          await tx.query(
            "UPDATE zc_orders SET executed_on=$2,completed_at=$2,status='CONCLUÍDO' WHERE id=$1",
            [order.id, day],
          );
          await f.makeEligible(tx, { ...order, executed_on: day });
          await tx.query(
            "UPDATE zc_financial_ledger SET eligible_on=$2 WHERE order_id=$1",
            [order.id, day],
          );
        });
      }
    }
    // One previous closing with a fictitious external partial payment.
    await transaction(db.pool, async (tx) => {
      const t = technicians[0],
        start = cal.add(d.today(), -14),
        end = cal.add(d.today(), -7),
        p = await f.preview(tx, t.id, start, end);
      const s = await f.createClosing(
        tx,
        {
          technician_id: t.id,
          start,
          end,
          extraordinary: true,
          reason: "Fechamento demonstrativo fictício",
          preview_hash: f.digest(p),
          request_key: "demo-closing-001",
        },
        "Demonstração local",
      );
      await f.approveClosing(tx, s.id, "Demonstração local");
      await f.payment(
        tx,
        s.id,
        {
          amount_cents: 3000,
          paid_on: end,
          reference: "SIMULADO — nenhum pagamento bancário",
          request_key: "demo-payment-001",
        },
        "Demonstração local",
      );
    });
    await db.pool.query(
      "INSERT INTO zc_migration_runs(fingerprint,source,created_at,summary) VALUES('local-demo-v1','local-fictional',$1,'{}')",
      [d.now()],
    );
    await fs.writeFile(credentialFile, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    });
  }
  const fixtures = online
    ? path.join(root, ".homologation-build/fixtures")
    : path.join(dataDir, "fixtures");
  if (online) await fs.access(path.join(fixtures, "checklist-ficticio.pdf"));
  else await require("./demo-fixtures.cjs").generate(fixtures);
  await listen(app, 4317);
  for (const [directory, port] of online
    ? []
    : [
        [path.join(field, "dist"), 4319],
        [path.join(root, "apps/web/dist"), 4320],
        [path.join(inventory, "invent-front/dist"), 4321],
      ]) {
    const web = express();
    web.use("/demo-files", express.static(fixtures));
    web.use(express.static(directory));
    web.get("/{*path}", (req, res) =>
      res.sendFile(path.join(directory, "index.html")),
    );
    await listen(web, port);
  }
  const worker = require("../apps/api/src/worker-loop").startWorker(
    db.pool,
    app.locals.config,
    { intervalMs: 1500 },
  );
  if (online) {
    const gateway = require("./online-demo.cjs").gateway({
      fixtures,
      config: onlineConfig,
    });
    const server = gateway.listen(onlineConfig.port, "0.0.0.0");
    await once(server, "listening");
    servers.unshift(server);
    console.log(
      "Homologação ONLINE TEMPORÁRIA pronta. Dados fictícios e efêmeros.",
    );
    console.log(
      "A senha de teste fica somente em ONLINE_DEMO_PASSWORD no Render.",
    );
    console.log(
      "Pico RSS: " + Math.ceil(process.resourceUsage().maxRSS / 1024) + " MiB",
    );
    console.log(
      "RSS inicial: " +
        Math.ceil(process.memoryUsage().rss / 1024 / 1024) +
        " MiB",
    );
  } else
    console.log(
      "\nHomologação LOCAL pronta. Nenhum serviço externo habilitado.",
    );
  if (!online)
    console.log(
      "ZenControl: http://127.0.0.1:4320 | ZenField: http://127.0.0.1:4319 | Estoque Pro: http://127.0.0.1:4321",
    );
  if (!online)
    console.log(
      "API central: http://127.0.0.1:4317 | API estoque: http://127.0.0.1:4318",
    );
  if (!online)
    console.log("Admin dos sistemas: admin / " + credentials.admin_password);
  if (!online)
    console.log(
      "Ativações individuais: " +
        credentialFile +
        " (códigos temporários; use a central para renovar).",
    );
  if (!online)
    console.log(
      "Arquivos fictícios: " +
        fixtures +
        " | http://127.0.0.1:4319/demo-files/rastreador-jose.jpg",
    );
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await worker.stop();
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    await Promise.all([db.close(), stockDb.close()]);
    if (sharedDb) await sharedDb.close();
    await fs.rm(pidFile, { force: true });
  }
  process.on("SIGINT", () => stop().then(() => process.exit(0)));
  process.on("SIGTERM", () => stop().then(() => process.exit(0)));
}
main().catch((e) => {
  console.error("Homologação não iniciada:", e.message);
  process.exit(1);
});
