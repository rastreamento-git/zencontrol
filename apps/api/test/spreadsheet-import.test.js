const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { once } = require("node:events");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const { createApp } = require("../src/app");
const { hashPassword } = require("../src/auth");
const { preview, type } = require("../src/spreadsheet-import");
const { prepareBackup, restoreBackup } = require("../src/backup");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
let db, server, base, token, operator;
const password = "Importacao1!Teste";
async function call(
  path,
  body,
  auth = token,
  contentType = "application/json",
) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": contentType,
      ...(auth ? { Authorization: "Bearer " + auth } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
async function workbook(rows, sheetName = "NOVEMBRO 2026") {
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet(sheetName);
  s.addRow([
    "",
    "SERVIÇOS",
    "NOME DO ASSOCIADO",
    "PLACA / CHASSI",
    "IMEI",
    "DATA DE ENVIO DO TERMO",
    "DATA DE CONCLUSÃO",
    "TÉCNICO",
    "REGIÃO",
    "VOLUNTÁRIO",
    "VALOR FIPE",
    "FIPE",
    "INCLUIU",
    "CONCLUIU",
    "SITUAÇÃO",
  ]);
  rows.forEach((r) => s.addRow(r));
  return Buffer.from(await w.xlsx.writeBuffer());
}
const row = (plate = "ABC1D23") => [
  "",
  "Instalação",
  "Cliente fictício",
  plate,
  "000007260510340",
  "01/11/2026",
  "02/11/2026",
  "Técnico fictício",
  "Niterói, RJ",
  "",
  "R$ 30.000,00",
  "ALTA",
  "Origem",
  "Origem",
  "CONCLUÍDO",
];
async function stage(bytes) {
  return call(
    "/api/spreadsheet-imports",
    { filename: "controle.xlsx", content: bytes.toString("base64") },
    token,
    type,
  );
}
before(async () => {
  db = await testDatabase();
  await migrate(db.pool);
  const app = createApp(db.pool, {
    APP_PASSWORD: password,
    SESSION_SECRET: "import-test-session-secret-123456789",
    ZEN_WEBHOOK_SECRET: "import-test-webhook-secret-123456789",
  });
  await app.locals.ready();
  await db.pool.query(
    "INSERT INTO usuarios(login,nome,senha_hash,papel) VALUES('op','Operador',$1,'operador')",
    [await hashPassword(password)],
  );
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
  token = (await call("/api/auth/login", { login: "admin", password }, null))
    .data.token;
  operator = (await call("/api/auth/login", { login: "op", password }, null))
    .data.token;
});
after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise((r) => server.close(r));
  await db?.close();
});
test("classifica controle, incompletos, duplicados e aba auxiliar sem descartar OS por observação", async () => {
  const a = row();
  a[15] = "Verificado até aqui";
  const missing = row("");
  const rows = await preview(
    await workbook([
      ["Fechamento"],
      ["", "", "", "", "", "", "", "Técnico"],
      a,
      row("DEF4G56"),
      row("DEF4G56"),
      missing,
    ]),
  );
  assert.deepEqual(
    rows.map((r) => r.state),
    ["ignored", "ignored", "ready", "duplicate", "duplicate", "pending"],
  );
  assert.equal(rows[2].data.imei, "000007260510340");
  assert.equal(rows[2].data.completed_at, "2026-11-02");
  assert.match(rows[2].data.notes, /Verificado/);
  assert.equal(
    (await preview(await workbook([row()], "Ativos")))[0].state,
    "ignored",
  );
});
test("exige administrador, confirmação e prévia persistida; repetições não duplicam nem geram efeitos operacionais", async () => {
  const bytes = await workbook([row()]);
  assert.equal(
    (
      await call(
        "/api/spreadsheet-imports",
        { filename: "x.xlsx", content: bytes.toString("base64") },
        operator,
        type,
      )
    ).status,
    403,
  );
  const p = await stage(bytes);
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.equal(p.data.counts.ready, 1);
  assert.equal((await db.pool.query("SELECT * FROM zc_orders")).rows.length, 0);
  assert.equal(
    (
      await call("/api/spreadsheet-imports/" + p.data.id + "/approve", {
        confirmation: "sim",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/spreadsheet-imports/" + p.data.id + "/approve",
        { confirmation: "IMPORTAR HISTORICO" },
        operator,
      )
    ).status,
    403,
  );
  const results = await Promise.all(
    [1, 2].map(() =>
      call("/api/spreadsheet-imports/" + p.data.id + "/approve", {
        confirmation: "IMPORTAR HISTORICO",
        rows: [{ fake: true }],
      }),
    ),
  );
  assert.ok(results.every((r) => r.status === 200));
  assert.ok(results.every((r) => r.data.imported === 1));
  const saved = (await db.pool.query("SELECT * FROM zc_orders")).rows;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].archive, "COLD");
  assert.equal(saved[0].technician_id, null);
  assert.equal(saved[0].created_date, "");
  assert.equal(saved[0].raw_legacy.row, 2);
  for (const table of [
    "zc_jobs",
    "zc_payments",
    "zc_financial_ledger",
    "zc_technicians",
  ])
    assert.equal(
      (await db.pool.query("SELECT * FROM " + table)).rows.length,
      0,
      table,
    );
  assert.equal((await stage(bytes)).data.counts.duplicate, 1);
  assert.equal(
    (
      await db.pool.query(
        "SELECT * FROM zc_audit WHERE action='spreadsheet_approved'",
      )
    ).rows.length,
    1,
  );
});
test("revalida prévias concorrentes e recusa expiração, datas impossíveis e ZIP inválido", async () => {
  const bytes = await workbook([row("GHI7J89")]);
  const a = await stage(bytes),
    b = await stage(bytes);
  assert.equal(
    (
      await call("/api/spreadsheet-imports/" + a.data.id + "/approve", {
        confirmation: "IMPORTAR HISTORICO",
      })
    ).data.imported,
    1,
  );
  assert.equal(
    (
      await call("/api/spreadsheet-imports/" + b.data.id + "/approve", {
        confirmation: "IMPORTAR HISTORICO",
      })
    ).data.imported,
    0,
  );
  const c = await stage(await workbook([row("JKL1M23")]));
  await db.pool.query(
    "UPDATE zc_spreadsheet_imports SET expires_at=now()-interval '1 day' WHERE id=$1",
    [c.data.id],
  );
  assert.equal(
    (
      await call("/api/spreadsheet-imports/" + c.data.id + "/approve", {
        confirmation: "IMPORTAR HISTORICO",
      })
    ).status,
    409,
  );
  const bad = row();
  bad[6] = "31/02/2026";
  assert.equal((await preview(await workbook([bad])))[0].state, "pending");
  await assert.rejects(preview(Buffer.from("not a zip")), /XLSX/);
});
test("backup restaura lotes e origem das OS sem exigir contas da instalação original", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zen-import-backup-"));
  const target = await testDatabase();
  let backup;
  try {
    await migrate(target.pool);
    backup = await prepareBackup(db.pool, { DATA_DIR: root });
    await fs.writeFile(path.join(root, "database.json"), backup.database);
    await fs.writeFile(path.join(root, "manifest.json"), backup.manifest);
    await restoreBackup(target.pool, { DATA_DIR: root }, root, true);
    const batches = (
      await target.pool.query("SELECT * FROM zc_spreadsheet_imports")
    ).rows;
    assert.ok(batches.some((b) => b.approved_at && b.result.imported === 1));
    assert.ok(
      batches.every((b) => b.created_by === null && b.approved_by === null),
    );
    const orders = (await target.pool.query("SELECT * FROM zc_orders")).rows;
    assert.equal(orders.length, 2);
    assert.equal(orders[0].raw_legacy.source, "spreadsheet");
    assert.equal(orders[0].archive, "COLD");
  } finally {
    await backup?.cleanup();
    await target.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
