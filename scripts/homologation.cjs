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
if (instance && !/^[a-zA-Z0-9_-]{1,64}$/.test(instance))
  throw Error("Nome de instância inválido.");
const dataDir = path.join(
  root,
  ".homologation" + (instance ? "-" + instance : ""),
);
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
  } = require("../apps/api/src/technician-access"),
  { photo } = require("../apps/api/test/helpers/equipment-photo.cjs");
const express = require("express"),
  { PDFDocument } = require("pdf-lib"),
  sharp = require("sharp");
async function main() {
  if (
    process.env.DATABASE_URL ||
    process.env.TEST_DATABASE_URL ||
    process.env.NODE_ENV === "production"
  )
    throw Error(
      "Remova DATABASE_URL/TEST_DATABASE_URL e NODE_ENV=production. Este inicializador só aceita bancos locais próprios.",
    );
  const inventory = path.resolve(
      process.env.ZEN_INVENTORY_REPO || path.join(workspace, "inventario-v2"),
    ),
    field = path.resolve(
      process.env.ZEN_FIELD_REPO || path.join(workspace, "zenfield"),
    );
  await fs.access(path.join(inventory, "invent-back/src/zencontrol.js"));
  await fs.access(path.join(field, "dist/index.html"));
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
      admin_password: "local-" + randomBytes(12).toString("hex"),
      secret: randomBytes(32).toString("hex"),
    };
    await fs.writeFile(credentialFile, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  }
  const scopedSecret = (purpose) =>
    createHmac("sha256", credentials.secret).update(purpose).digest("hex");
  const db = await localDatabase(path.join(dataDir, "zencontrol")),
    stockDb = await localDatabase(path.join(dataDir, "estoque-pro"));
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
      NODE_ENV: "test",
      APP_PASSWORD: credentials.admin_password,
      SESSION_SECRET: scopedSecret("stock-session"),
      ZENCONTROL_INTEGRATION_SECRET: scopedSecret("stock-integration"),
      CORS_ORIGINS: "http://127.0.0.1:4321",
    }),
    4318,
  );
  const app = createApp(db.pool, {
    NODE_ENV: "test",
    APP_PASSWORD: credentials.admin_password,
    SESSION_SECRET: scopedSecret("central-session"),
    ZEN_WEBHOOK_SECRET: scopedSecret("legacy-webhook"),
    ZEN_PUBLIC_URL: "http://127.0.0.1:4317",
    TECHNICIAN_PORTAL_URL: "http://127.0.0.1:4319",
    CORS_ORIGINS:
      "http://127.0.0.1:4319,http://127.0.0.1:4320,http://127.0.0.1:4321",
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
  const fixtures = path.join(dataDir, "fixtures");
  await fs.mkdir(fixtures, { recursive: true });
  for (const [name, code, format] of [
    ["rastreador-jose", "123456789012345", "Code128"],
    ["tag-jose", "TAG-HOMO-001", "QRCode"],
    ["rastreador-maria", "123456789012346", "Code128"],
    ["tag-maria", "TAG-HOMO-002", "QRCode"],
  ])
    await fs.writeFile(
      path.join(fixtures, name + ".jpg"),
      Buffer.from((await photo(code, format)).split(",")[1], "base64"),
    );
  await fs.writeFile(
    path.join(fixtures, "foto-vistoria-exemplo.jpg"),
    await sharp({
      create: { width: 900, height: 600, channels: 3, background: "#d3dfed" },
    })
      .jpeg()
      .toBuffer(),
  );
  const pdf = await PDFDocument.create();
  pdf
    .addPage()
    .drawText(
      "CHECKLIST FICTICIO - homologacao local - assinatura de demonstracao",
    );
  await fs.writeFile(
    path.join(fixtures, "checklist-ficticio.pdf"),
    await pdf.save(),
  );
  await listen(app, 4317);
  for (const [directory, port] of [
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
  console.log("\nHomologação LOCAL pronta. Nenhum serviço externo habilitado.");
  console.log(
    "ZenControl: http://127.0.0.1:4320 | ZenField: http://127.0.0.1:4319 | Estoque Pro: http://127.0.0.1:4321",
  );
  console.log(
    "API central: http://127.0.0.1:4317 | API estoque: http://127.0.0.1:4318",
  );
  console.log("Admin dos sistemas: admin / " + credentials.admin_password);
  console.log(
    "Ativações individuais: " +
      credentialFile +
      " (códigos temporários; use a central para renovar).",
  );
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
    await fs.rm(pidFile, { force: true });
  }
  process.on("SIGINT", () => stop().then(() => process.exit(0)));
  process.on("SIGTERM", () => stop().then(() => process.exit(0)));
}
main().catch((e) => {
  console.error("Homologação não iniciada:", e.message);
  process.exit(1);
});
