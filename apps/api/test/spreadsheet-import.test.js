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
const reviewTokens = new Map();
const password = "Importacao1!Teste";
async function call(
  path,
  body,
  auth = token,
  contentType = "application/json",
) {
  if (body?.confirmed && path.endsWith("/approve") && !body.review_token)
    body = { ...body, review_token: reviewTokens.get(path.split("/")[3]) };
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
  const upload = await call(
    "/api/spreadsheet-imports",
    { filename: "controle.xlsx", content: bytes.toString("base64") },
    token,
    type,
  );
  if (upload.status !== 201) return upload;
  const reviewed = await call(
    `/api/spreadsheet-imports/${upload.data.id}/review`,
    {
      sheets: upload.data.sheets.filter((s) => s.eligible).map((s) => s.name),
      groups: [],
      archive: "HOT",
    },
  );
  reviewTokens.set(upload.data.id, reviewed.data.review_token);
  return { ...reviewed, status: 201 };
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
        confirmed: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/spreadsheet-imports/" + p.data.id + "/approve",
        { confirmed: true },
        operator,
      )
    ).status,
    403,
  );
  const results = await Promise.all(
    [1, 2].map(() =>
      call("/api/spreadsheet-imports/" + p.data.id + "/approve", {
        confirmed: true,
        rows: [{ fake: true }],
      }),
    ),
  );
  assert.ok(results.every((r) => r.status === 200));
  assert.ok(results.every((r) => r.data.imported === 1));
  const saved = (await db.pool.query("SELECT * FROM zc_orders")).rows;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].archive, "HOT");
  assert.equal(saved[0].technician_id, null);
  assert.equal(saved[0].created_date, saved[0].term);
  assert.match(
    saved[0].id,
    new RegExp("^" + saved[0].term.replaceAll("-", "") + "[0-9A-F]{3}$"),
  );
  assert.equal(saved[0].raw_legacy.numbering.source, "term");
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
        confirmed: true,
      })
    ).data.imported,
    1,
  );
  assert.equal(
    (
      await call("/api/spreadsheet-imports/" + b.data.id + "/approve", {
        confirmed: true,
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
        confirmed: true,
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
    assert.equal(orders[0].archive, "HOT");
    const counters = (
      await target.pool.query("SELECT * FROM zc_order_counters ORDER BY day")
    ).rows;
    assert.deepEqual(
      counters,
      (await db.pool.query("SELECT * FROM zc_order_counters ORDER BY day"))
        .rows,
    );
    const day = orders[0].created_date;
    const last = Math.max(
      ...orders
        .filter((o) => o.created_date === day)
        .map((o) => parseInt(o.id.slice(-3), 16)),
    );
    const next = await require("../src/database").transaction(
      target.pool,
      (tx) => require("../src/order-numbering").nextOrderId(tx, day),
    );
    assert.equal(
      next,
      day.replaceAll("-", "") +
        (last + 1).toString(16).toUpperCase().padStart(3, "0"),
    );
  } finally {
    await backup?.cleanup();
    await target.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("identifica etapa por evidências sem encerrar pendências de meses anteriores", async () => {
  const { infer, period } = require("../src/spreadsheet-structure");
  assert.equal(period("Março / 2027"), "2027-03");
  assert.equal(period("NOVEMBRO-2026"), "2026-11");
  const check = (status, completed = "", scheduled = "", month = "2026-06") =>
    infer({ status, completed, scheduled, month, today: "2026-11-13" });
  assert.equal(check("PENDENTE").archive, "");
  assert.equal(check("PENDENTE").workflow_mode, "controlled");
  assert.equal(check("", "2026-06-20").status, "CONCLUÍDO");
  assert.equal(check("", "2026-06-20").archive, "");
  assert.equal(check("CONCLUÍDO", "2026-10-20").archive, "");
  assert.equal(check("CONCLUÍDO", "2026-11-02").archive, "");
  assert.equal(check("", "", "2026-09-10").status, "AGENDADO");
  assert.equal(check("CANCELADO EM SISTEMA").status, "CANCELADO");
  assert.equal(check("REAGENDAR").archive, "");
  assert.ok(check("PENDENTE", "2026-06-20").issues.length);
  assert.ok(check("CANCELAMENTO PENDENTE").issues.length);
  assert.ok(check("SEGURADO SEM RASTREADOR").issues.length);
  assert.ok(check("AGUARDANDO CONFERÊNCIA").issues.length);
  assert.ok(check("CONCLUÍDO", "2026-12-01").issues.length);
  const pending = row("MNO2P34");
  pending[14] = "PENDENTE";
  pending[6] = "";
  const rows = await preview(
    await workbook([pending], "JUNHO 2026"),
    "2026-11-13",
  );
  assert.equal(rows[0].state, "ready");
  assert.equal(rows[0].data.status, "PENDENTE");
  assert.equal(rows[0].data.archive, "");
  assert.equal(rows[0].period, "2026-06");
});

test("descobre cabeçalho deslocado, colunas reordenadas e data sem ano pela aba", async () => {
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet("MARÇO - 2027");
  s.addRow(["Controle geral"]);
  s.addRow([]);
  s.addRow([
    "PLACA",
    "SITUAÇÃO",
    "ASSOCIADO",
    "SERVIÇO",
    "DATA DE AGENDAMENTO",
    "TURNO",
    "TÉCNICO",
    "IMEI",
  ]);
  s.addRow([
    "PQR3S45",
    "",
    "Cliente de teste",
    "Instalação",
    "14/03",
    "Manhã",
    "Técnico fictício",
    "000007260510340",
  ]);
  const rows = await preview(
    Buffer.from(await w.xlsx.writeBuffer()),
    "2027-03-10",
  );
  assert.equal(rows[0].row, 4);
  assert.equal(rows[0].state, "ready");
  assert.equal(rows[0].data.status, "AGENDADO");
  assert.equal(rows[0].data.scheduled_at, "2027-03-14");
  assert.equal(rows[0].data.imei, "000007260510340");
});

test("migra pendentes e agenda para operação, vincula técnico único e bloqueia prévia antiga", async () => {
  const tech = (
    await db.pool.query(
      "INSERT INTO zc_technicians(name) VALUES('Técnico fictício') RETURNING id",
    )
  ).rows[0];
  const pending = row("STU4V56");
  pending[14] = "PENDENTE";
  pending[6] = "";
  const scheduled = row("VWX5Y67");
  scheduled[14] = "";
  scheduled[6] = "";
  scheduled[15] = "14/11/2026";
  scheduled[16] = "Manhã";
  const p = await stage(await workbook([pending, scheduled], "JUNHO 2026"));
  assert.equal(p.data.counts.ready, 2, JSON.stringify(p.data));
  assert.equal(p.data.rows[1].data.status, "AGENDADO");
  assert.equal(p.data.rows[1].data.technician_id, tech.id);
  assert.equal(
    (
      await call("/api/spreadsheet-imports/" + p.data.id + "/approve", {
        confirmed: true,
      })
    ).data.imported,
    2,
  );
  const active = (
    await db.pool.query(
      "SELECT * FROM zc_orders WHERE workflow_mode='controlled'",
    )
  ).rows;
  assert.equal(active.length, 2);
  assert.ok(
    active.every((o) => o.archive === "HOT" && o.technician_id === tech.id),
  );
  assert.equal(
    active.find((o) => o.status === "AGENDADO").scheduled_at,
    "2026-11-14",
  );
  assert.ok(active.every((o) => o.raw_legacy.period === "2026-06"));
  const missing = row("YZA6B78");
  missing[6] = "";
  missing[14] = "AGENDADO";
  missing[7] = "Não cadastrado";
  missing[15] = "14/11/2026";
  missing[16] = "Tarde";
  assert.equal((await stage(await workbook([missing]))).data.counts.pending, 1);
  const stale = await stage(await workbook([row("BCD7E89")]));
  await db.pool.query("UPDATE zc_spreadsheet_imports SET rows=$2 WHERE id=$1", [
    stale.data.id,
    JSON.stringify([{ state: "ready", data: row() }]),
  ]);
  assert.equal(
    (
      await call("/api/spreadsheet-imports/" + stale.data.id + "/approve", {
        confirmed: true,
      })
    ).status,
    409,
  );
  for (const table of ["zc_jobs", "zc_payments", "zc_financial_ledger"])
    assert.equal(
      (await db.pool.query("SELECT * FROM " + table)).rows.length,
      0,
    );
});

test("converte duas TAGs em instalação com OS adicional sem movimentações automáticas", async () => {
  const r = row("EFG8H90");
  r[1] = "Duas TAGs";
  r[14] = "PENDENTE";
  r[6] = "";
  const p = await stage(await workbook([r]));
  assert.equal(p.data.counts.ready, 1);
  assert.equal(p.data.rows[0].additional_orders, 1);
  assert.deepEqual(p.data.rows[0].data.document_data.equipment_counts, {
    tracker: 0,
    tag: 2,
  });
  const result = await call(
    "/api/spreadsheet-imports/" + p.data.id + "/approve",
    { confirmed: true },
  );
  assert.equal(result.data.imported, 1);
  assert.equal(result.data.additional_orders, 1);
  const saved = (
    await db.pool.query(
      "SELECT * FROM zc_orders WHERE vehicle='EFG8H90' ORDER BY parent_order_id NULLS FIRST",
    )
  ).rows;
  assert.equal(saved.length, 2);
  assert.equal(saved[1].parent_order_id, saved[0].id);
  assert.equal(saved[1].additional_equipment, "TAG");
  assert.equal(saved[1].raw_legacy.source, "spreadsheet");
  assert.ok(
    saved.every((o) => o.workflow_mode === "controlled" && o.archive === "HOT"),
  );
  assert.equal(
    (await db.pool.query("SELECT * FROM zc_notifications")).rows.length,
    0,
  );
});

test("abas selecionadas agrupam rastreador e TAG automaticamente, preservando os seriais", async () => {
  const w = new ExcelJS.Workbook();
  const header = [
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
  ];
  const nov = w.addWorksheet("NOVEMBRO 2026");
  nov.addRow(header);
  const tracker = row("HIJ9K01"),
    tag = row("HIJ9K01");
  tracker[14] = tag[14] = "PENDENTE";
  tracker[6] = tag[6] = "";
  tag[1] = "TAG";
  tag[4] = "000007260510341";
  nov.addRow(tracker);
  nov.addRow(tag);
  const jun = w.addWorksheet("JUNHO 2026");
  jun.addRow(header);
  jun.addRow(row("KLM1N23"));
  const aux = w.addWorksheet("Ativos");
  aux.addRow(header);
  aux.addRow(row("NOP2Q34"));
  const upload = await call(
    "/api/spreadsheet-imports",
    {
      filename: "controle.xlsx",
      content: Buffer.from(await w.xlsx.writeBuffer()).toString("base64"),
    },
    token,
    type,
  );
  assert.equal(upload.status, 201);
  assert.equal(upload.data.reviewed, false);
  assert.equal(upload.data.rows.length, 0);
  const id = upload.data.id,
    endpoint = `/api/spreadsheet-imports/${id}`;
  const review = await call(endpoint + "/review", {
    sheets: ["NOVEMBRO 2026"],
    archive: "HOT",
  });
  assert.equal(review.status, 200);
  assert.equal(review.data.counts.ready, 1);
  assert.equal(review.data.counts.duplicate, 0);
  assert.equal(review.data.rows[0].sources.length, 2);
  assert.equal(review.data.rows[0].equipment[1].serial, tag[4]);
  await call(endpoint + "/review", { sheets: ["JUNHO 2026"], archive: "HOT" });
  assert.equal(
    (
      await call(endpoint + "/approve", {
        confirmed: true,
        review_token: review.data.review_token,
      })
    ).status,
    409,
  );
  const final = await call(endpoint + "/review", {
    sheets: ["NOVEMBRO 2026"],
    archive: "HOT",
  });
  const result = await call(endpoint + "/approve", {
    confirmed: true,
    review_token: final.data.review_token,
  });
  assert.equal(result.data.imported, 1);
  assert.equal(result.data.additional_orders, 1);
  const saved = (
    await db.pool.query(
      "SELECT * FROM zc_orders WHERE vehicle='HIJ9K01' ORDER BY parent_order_id NULLS FIRST",
    )
  ).rows;
  assert.equal(saved.length, 2);
  assert.equal(saved[1].imei, tag[4]);
  assert.equal(saved[1].parent_order_id, saved[0].id);
  assert.equal(saved[0].raw_legacy.sources.length, 2);
  assert.equal(
    (
      await db.pool.query(
        "SELECT * FROM zc_orders WHERE vehicle IN ('KLM1N23','NOP2Q34')",
      )
    ).rows.length,
    0,
  );
  assert.equal((await call("/api/orders?q=HIJ9K01")).data.items.length, 1);
});

test("leitura de aba auxiliar extensa cabe em heap de 128 MB", async () => {
  const { promisify } = require("node:util"),
    { execFile } = require("node:child_process");
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--max-old-space-size=128",
      path.join(__dirname, "fixtures/spreadsheet-memory.cjs"),
    ],
    { timeout: 60000, maxBuffer: 4096 },
  );
  assert.match(stdout, /streaming-memory-ok/);
});

test("administrador escolhe a base e exporta todos os campos além do resumo", async () => {
  const source = row("QRS3T45");
  source[19] = "Campo complementar integral";
  const p = await stage(await workbook([source]));
  const endpoint = `/api/spreadsheet-imports/${p.data.id}`;
  assert.equal(
    (
      await call(endpoint + "/review", {
        sheets: ["NOVEMBRO 2026"],
        groups: [],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(endpoint + "/review", {
        sheets: ["NOVEMBRO 2026"],
        groups: [],
        archive: "AUTOMATICO",
      })
    ).status,
    400,
  );
  const cold = await call(endpoint + "/review", {
    sheets: ["NOVEMBRO 2026"],
    groups: [],
    archive: "COLD",
  });
  assert.equal(cold.data.archive, "COLD");
  assert.equal(cold.data.rows[0].data.archive, "COLD");
  const forbidden = await fetch(base + endpoint + "/export", {
    headers: { Authorization: "Bearer " + operator },
  });
  assert.equal(forbidden.status, 403);
  const response = await fetch(base + endpoint + "/export", {
    headers: { Authorization: "Bearer " + token },
  });
  assert.equal(response.status, 200);
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.deepEqual(exported.getWorksheet("Resumo").getRow(1).values.slice(1), [
    "Nome",
    "Placa",
    "IMEI",
  ]);
  assert.equal(
    exported.getWorksheet("Resumo").getCell("C2").value,
    "000007260510340",
  );
  assert.equal(
    exported.getWorksheet("Origem 1").getCell("G2").value,
    "000007260510340",
  );
  assert.equal(
    exported.getWorksheet("Origem 1").getCell("V2").value,
    "Campo complementar integral",
  );
  const result = await call(endpoint + "/approve", {
    confirmed: true,
    review_token: cold.data.review_token,
  });
  assert.equal(result.data.imported, 1);
  const saved = (
    await db.pool.query("SELECT * FROM zc_orders WHERE vehicle='QRS3T45'")
  ).rows[0];
  assert.equal(saved.archive, "COLD");
  assert.match(saved.notes, /Campo complementar integral/);
  const pending = row("TUV4W56");
  pending[6] = "";
  pending[14] = "PENDENTE";
  const open = await stage(await workbook([pending]));
  const warm = await call(`/api/spreadsheet-imports/${open.data.id}/review`, {
    sheets: ["NOVEMBRO 2026"],
    groups: [],
    archive: "WARM",
  });
  assert.equal(warm.data.rows[0].data.archive, "WARM");
  assert.equal(warm.data.rows[0].data.status, "PENDENTE");
});

test("duplicidade usa nome e veículo, agrupa dois rastreadores e sinaliza conclusão na importação", async () => {
  const first = row("WXY5Z67"),
    second = row("WXY5Z67");
  first[6] = "";
  second[6] = "";
  second[1] = "Manutenção";
  second[4] = "000007260510342";
  const staged = await stage(await workbook([first, second]));
  assert.equal(staged.data.counts.ready, 1);
  assert.equal(staged.data.counts.duplicate, 0);
  const endpoint = `/api/spreadsheet-imports/${staged.data.id}`;
  const review = await call(endpoint + "/review", {
    sheets: ["NOVEMBRO 2026"],
    archive: "WARM",
    groups: [["NOVEMBRO 2026:2", "NOVEMBRO 2026:3"]],
  });
  assert.equal(review.data.counts.ready, 1, JSON.stringify(review.data));
  const entry = review.data.rows[0];
  assert.equal(entry.additional_imei, second[4]);
  assert.deepEqual(entry.data.document_data.equipment_counts, {
    tracker: 2,
    tag: 0,
  });
  assert.equal(entry.completion_date_source, "import_date");
  assert.equal(entry.group_warning, true);
  const download = await fetch(base + endpoint + "/export", {
    headers: { Authorization: "Bearer " + token },
  });
  const file = new ExcelJS.Workbook();
  await file.xlsx.load(Buffer.from(await download.arrayBuffer()));
  assert.equal(
    file.getWorksheet("Revisão completa").getCell("F2").value,
    second[4],
  );
  assert.equal(
    file.getWorksheet("Revisão completa").getCell("G2").value,
    "Data da importação",
  );

  const approved = await call(endpoint + "/approve", {
    confirmed: true,
    review_token: review.data.review_token,
  });
  assert.equal(approved.data.imported, 1);
  assert.equal(approved.data.additional_orders, 1);
  const saved = (
    await db.pool.query(
      "SELECT * FROM zc_orders WHERE vehicle='WXY5Z67' ORDER BY parent_order_id NULLS FIRST",
    )
  ).rows;
  assert.equal(saved[0].imei, first[4]);
  assert.equal(saved[1].imei, second[4]);
  assert.equal(saved[1].additional_equipment, "RASTREADOR");
  assert.ok(
    saved.every(
      (o) =>
        o.completed_at === require("../src/domain").today() &&
        o.document_data.completion_date_source === "import_date",
    ),
  );
  assert.equal(saved[0].raw_legacy.completion_date_source, "import_date");
  const different = row("WXY5Z67");
  different[2] = "Outro associado";
  const check = await preview(await workbook([first, different]));
  assert.equal(check.filter((r) => r.state === "ready").length, 2);
  const existing = await stage(await workbook([row("WXY5Z67")]));
  assert.equal(existing.data.counts.duplicate, 1);
});

test("agrupa várias linhas automaticamente e conta IMEI repetido uma única vez", async () => {
  const { groupRows } = require("../src/spreadsheet-grouping");
  const a = row("ZAB6C78"),
    b = row("ZAB6C78"),
    c = row("ZAB6C78");
  b[4] = "000007260510343";
  c[1] = "TAG";
  c[4] = "000007260510344";
  const source = await preview(await workbook([a, b, c, a]), undefined, false);
  const rows = groupRows(source);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "ready");
  assert.equal(rows[0].sources.length, 4);
  assert.equal(rows[0].equipment.length, 3);
  assert.equal(rows[0].additional_orders, 2);
  assert.equal(rows[0].group_warning, true);
  assert.match(rows[0].inference.join(" "), /contado uma única vez/);
  assert.deepEqual(rows[0].data.document_data.equipment_counts, {
    tracker: 2,
    tag: 1,
  });
  const staged = await stage(await workbook([a, b, c, a]));
  assert.equal(staged.data.counts.ready, 1);
  const result = await call(
    `/api/spreadsheet-imports/${staged.data.id}/approve`,
    { confirmed: true },
  );
  assert.equal(result.data.imported, 1);
  assert.equal(result.data.additional_orders, 2);
  const saved = (
    await db.pool.query("SELECT * FROM zc_orders WHERE vehicle='ZAB6C78'")
  ).rows;
  assert.equal(saved.length, 3);
  const composite = row("BCD7E89"),
    tag = row("BCD7E89");
  composite[1] = "Instalação + TAG";
  composite[14] = tag[14] = "PENDENTE";
  composite[6] = tag[6] = "";
  tag[1] = "TAG";
  tag[4] = "000007260510345";
  const combined = groupRows(
    await preview(await workbook([composite, tag]), undefined, false),
  );
  assert.equal(combined[0].equipment.length, 2);
  assert.equal(combined[0].equipment[1].serial, tag[4]);

  assert.equal(new Set(saved.map((r) => r.imei)).size, 3);
});

test("numera pela data do termo de cada equipamento agrupado e identifica a data presumida", async () => {
  const a = row("HEX1A23"),
    b = row("HEX1A23"),
    missing = row("HEX2B34");
  a[5] = "30/10/2026";
  a[4] = "123456789012345";
  b[5] = "31/10/2026";
  b[4] = "123456789012346";
  missing[5] = "";
  const p = await stage(await workbook([a, b, missing]));
  assert.equal(p.data.counts.ready, 2);
  assert.equal(
    p.data.rows.find((r) => r.data?.vehicle === "HEX1A23").numbering.date,
    "2026-10-30",
  );
  assert.equal(
    p.data.rows.find((r) => r.data?.vehicle === "HEX2B34").numbering.source,
    "import_date",
  );
  const endpoint = `/api/spreadsheet-imports/${p.data.id}/approve`;
  const approved = await call(endpoint, { confirmed: true });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const saved = (
    await db.pool.query(
      "SELECT * FROM zc_orders WHERE vehicle IN ('HEX1A23','HEX2B34') ORDER BY id",
    )
  ).rows;
  const main = saved.find((r) => r.vehicle === "HEX1A23" && !r.parent_order_id);
  const extra = saved.find((r) => r.parent_order_id === main.id);
  const fallback = saved.find((r) => r.vehicle === "HEX2B34");
  assert.match(main.id, /^20261030[0-9A-F]{3}$/);
  assert.match(extra.id, /^20261031[0-9A-F]{3}$/);
  assert.equal(extra.term, "2026-10-31");
  assert.equal(main.completed_at, "2026-11-02");
  assert.equal(extra.raw_legacy.numbering.source, "term");
  const today = require("../src/domain").today();
  assert.match(
    fallback.id,
    new RegExp("^" + today.replaceAll("-", "") + "[0-9A-F]{3}$"),
  );
  assert.equal(fallback.raw_legacy.numbering.source, "import_date");
  assert.equal(fallback.term, "");
  const counters = (
    await db.pool.query("SELECT * FROM zc_order_counters ORDER BY day")
  ).rows;
  assert.equal((await call(endpoint, { confirmed: true })).status, 200);
  assert.deepEqual(
    (await db.pool.query("SELECT * FROM zc_order_counters ORDER BY day")).rows,
    counters,
  );
});

test("limite diário interrompe o lote inteiro sem importar uma parte ou consumir números", async () => {
  const a = row("LIM1A23"),
    b = row("LIM2B34");
  a[5] = b[5] = "30/09/2026";
  const p = await stage(await workbook([a, b]));
  await db.pool.query(
    "INSERT INTO zc_order_counters(day,last_value) VALUES('2026-09-30',4094)",
  );
  const result = await call(`/api/spreadsheet-imports/${p.data.id}/approve`, {
    confirmed: true,
  });
  assert.equal(result.status, 409, JSON.stringify(result.data));
  assert.equal(
    (
      await db.pool.query(
        "SELECT id FROM zc_orders WHERE vehicle IN ('LIM1A23','LIM2B34')",
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.pool.query(
        "SELECT last_value FROM zc_order_counters WHERE day='2026-09-30'",
      )
    ).rows[0].last_value,
    4094,
  );
  const batch = (await call(`/api/spreadsheet-imports/${p.data.id}`)).data;
  assert.equal(batch.approved_at, null);
});
