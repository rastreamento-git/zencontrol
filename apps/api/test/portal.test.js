const { test, before, after } = require("node:test");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events");
const sharp = require("sharp");
const { photo } = require("./helpers/equipment-photo.cjs");
const { PDFDocument } = require("pdf-lib");
const { mockSupabase, config: mediaConfig } = require("./helpers/supabase.cjs");
const remote = mockSupabase();
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const {
  migrate: stockMigrate,
} = require("../../../integrations/estoque-pro/scripts/migrate");
const { move } = require("../../../integrations/estoque-pro/src/inventory");
const { createApp } = require("../src/app"),
  {
    createApp: stockApp,
  } = require("../../../integrations/estoque-pro/src/app");
const { configuration } = require("../src/config"),
  { runOne } = require("../src/jobs"),
  { StockClient, StockError } = require("../src/stock-client");
const secret = "test-only-stock-integration-secret-123456789",
  password = "Portal1!teste";
let db,
  sdb,
  pool,
  spool,
  server,
  ss,
  base,
  sbase,
  cfg,
  admin,
  operator,
  ta,
  tb,
  tida,
  tidb,
  stockA,
  stockB,
  product,
  jpg,
  folder;
async function req(route, method = "GET", body, token = admin) {
  const r = await fetch(base + route, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bytes = Buffer.from(await r.arrayBuffer());
  let data;
  try {
    data = JSON.parse(bytes);
  } catch {
    data = bytes;
  }
  return { status: r.status, data };
}
async function ok(route, method, body, token, expected = 200) {
  const r = await req(route, method, body, token);
  assert.equal(r.status, expected, JSON.stringify(r.data));
  return r.data;
}
async function login(login) {
  return (await ok("/api/auth/login", "POST", { login, password }, null)).token;
}
async function order(service = "Instalação", tid = tida) {
  return ok(
    "/api/orders",
    "POST",
    {
      vehicle: "POR1T23",
      service,
      customer_name: "Cliente de teste",
      technician_id: tid,
      scheduled_at: "2026-10-20T10:00",
      workflow_mode: "legacy",
    },
    admin,
    201,
  );
}
async function serials(codes, tid = stockA, model = product) {
  await move(spool, "entrada", { produto_id: model, seriais: codes });
  await move(spool, "transferir", {
    produto_id: model,
    tecnico_id: tid,
    seriais: codes,
  });
}
async function submission(o, codes = ["123456789012345"], service = "install") {
  let b = await ok(
    "/api/technician/orders/" + o.id + "/draft",
    "POST",
    { version: o.version },
    ta,
    201,
  );
  for (const kind of service === "install"
    ? ["vehicle", "label", "installed", "inspection", "checklist"]
    : ["vehicle", "service", "inspection", "checklist"]) {
    const r = await ok(
      "/api/technician/batches/" + b.id + "/photos",
      "POST",
      {
        version: b.version,
        kind,
        serial_code: kind === "label" ? codes[0] : "",
        image: kind === "label" ? await photo(codes[0]) : jpg,
      },
      ta,
      201,
    );
    b.version = r.version;
  }
  await ok(
    "/api/technician/batches/" + b.id + "/submit",
    "POST",
    {
      version: b.version,
      serials: codes,
      notes: "Atendimento finalizado, conferido.",
      confirmed: true,
      checklist_signed: true,
    },
    ta,
  );
  return await ok("/api/batches/" + b.id);
}
async function approve(b) {
  return ok(
    "/api/batches/" + b.id + "/approve",
    "POST",
    {
      version: b.version,
      order_version: b.current_order.version,
      serials: b.imeis,
      reason: "Fotos e códigos conferidos na central.",
      checklist_reviewed: true,
    },
    operator,
  );
}
async function stockRequest(payload, key, token = secret) {
  const r = await fetch(sbase + "/api/integrations/zencontrol/installations", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(payload),
  });
  return { status: r.status, data: await r.json() };
}
before(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "zc-portal-"));
  db = await testDatabase();
  sdb = await testDatabase();
  pool = db.pool;
  spool = sdb.pool;
  await migrate(pool);
  await stockMigrate(spool);
  ss = stockApp(spool, {
    NODE_ENV: "test",
    SESSION_SECRET: secret,
    APP_PASSWORD: password,
    ZENCONTROL_INTEGRATION_SECRET: secret,
  }).listen(0, "127.0.0.1");
  await once(ss, "listening");
  sbase = "http://127.0.0.1:" + ss.address().port;
  stockA = (
    await spool.query(
      "INSERT INTO tecnicos(nome) VALUES('Ana estoque') RETURNING id",
    )
  ).rows[0].id;
  stockB = (
    await spool.query(
      "INSERT INTO tecnicos(nome) VALUES('Bruno estoque') RETURNING id",
    )
  ).rows[0].id;
  product = (
    await spool.query(
      "INSERT INTO produtos(nome,categoria) VALUES('Modelo teste','RASTREADOR') RETURNING id",
    )
  ).rows[0].id;
  cfg = configuration({
    ...mediaConfig,
    NODE_ENV: "test",
    APP_PASSWORD: password,
    SESSION_SECRET: secret,
    ZEN_WEBHOOK_SECRET: secret,
    ZEN_DATA_DIR: folder,
    INTEGRATIONS_ENABLED: "false",
    STOCK_ENABLED: "true",
    STOCK_API_URL: sbase,
    STOCK_API_SECRET: secret,
    STOCK_SOURCE_SYSTEM: "zencontrol-test",
    TECHNICIAN_PORTAL_URL: "https://portal-tecnico.example.test",
  });
  const app = createApp(pool, cfg);
  await app.locals.ready();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
  admin = await login("admin");
  tida = (
    await ok(
      "/api/technicians",
      "POST",
      { name: "Ana campo", stock_technician_id: stockA },
      admin,
      200,
    )
  ).id;
  tidb = (
    await ok(
      "/api/technicians",
      "POST",
      { name: "Bruno campo", stock_technician_id: stockB },
      admin,
      200,
    )
  ).id;
  for (const [login, nome, papel, technician_id] of [
    ["ana", "Ana", "tecnico", tida],
    ["bruno", "Bruno", "tecnico", tidb],
    ["central", "Central", "operador", null],
  ])
    await ok(
      "/api/users",
      "POST",
      { login, nome, papel, technician_id, password },
      admin,
      200,
    );
  ta = await login("ana");
  tb = await login("bruno");
  operator = await login("central");
  jpg =
    "data:image/jpeg;base64," +
    (
      await sharp({
        create: { width: 64, height: 64, channels: 3, background: "#2b64e8" },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64");
});
after(async () => {
  remote.restore();
  if (server) await new Promise((r) => server.close(r));
  if (ss) await new Promise((r) => ss.close(r));
  if (db) await db.close();
  if (sdb) await sdb.close();
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});
test("foto remota sobrevive à perda do disco e continua restrita ao técnico responsável", async () => {
  const item = await order();
  const draft = await ok(
    "/api/technician/orders/" + item.id + "/draft",
    "POST",
    { version: item.version },
    ta,
    201,
  );
  const photo = await ok(
    "/api/technician/batches/" + draft.id + "/photos",
    "POST",
    {
      version: draft.version,
      kind: "vehicle",
      image: jpg,
    },
    ta,
    201,
  );
  await fs.rm(folder, { recursive: true, force: true });
  const route = "/api/technician/evidence/" + photo.id;
  const own = await req(route, "GET", undefined, ta);
  assert.equal(own.status, 200);
  assert.ok(Buffer.isBuffer(own.data));
  assert.equal((await req(route, "GET", undefined, tb)).status, 404);
  assert.equal((await req("/api/evidence/" + photo.id)).status, 200);
});
test("falha no upload remoto não deixa foto pronta nem altera a versão do envio", async () => {
  const item = await order();
  const draft = await ok(
    "/api/technician/orders/" + item.id + "/draft",
    "POST",
    { version: item.version },
    ta,
    201,
  );
  remote.state.failUpload = true;
  try {
    const response = await req(
      "/api/technician/batches/" + draft.id + "/photos",
      "POST",
      {
        version: draft.version,
        kind: "vehicle",
        image: jpg,
      },
      ta,
    );
    assert.equal(response.status, 503);
    assert.equal(
      JSON.stringify(response.data).includes(mediaConfig.SUPABASE_SECRET_KEY),
      false,
    );
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT count(*) n FROM zc_evidence WHERE batch_id=$1",
            [draft.id],
          )
        ).rows[0].n,
      ),
      0,
    );
    assert.equal(
      (
        await pool.query("SELECT version FROM zc_batches WHERE id=$1", [
          draft.id,
        ])
      ).rows[0].version,
      draft.version,
    );
  } finally {
    remote.state.failUpload = false;
  }
});
test("new orders cannot opt out of approval; technician role is isolated by assignment", async () => {
  const a = await order(),
    b = await order("Instalação", tidb);
  assert.equal(a.workflow_mode, "controlled");
  const list = await ok("/api/technician/orders", "GET", undefined, ta);
  assert.ok(list.items.some((o) => o.id === a.id));
  assert.ok(!list.items.some((o) => o.id === b.id));
  assert.equal(list.items[0].created_by, undefined);
  for (const route of [
    "/api/orders",
    "/api/users",
    "/api/technicians",
    "/api/finance/settlements",
    "/api/jobs",
    "/api/overview",
    "/api/service-rules",
    "/api/stock/catalog",
  ])
    assert.equal((await req(route, "GET", undefined, ta)).status, 403, route);
  assert.equal(
    (await req("/api/technician/orders/" + b.id, "GET", undefined, ta)).status,
    404,
  );
  assert.equal(
    (
      await req(
        "/api/technician/orders/" + a.id + "/draft",
        "POST",
        { version: a.version },
        tb,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await req("/api/orders/" + a.id + "/complete", "POST", {
        reason: "Tentativa de baixa sem conferência",
        version: a.version,
      })
    ).status,
    409,
  );
});
test("submission requires confirmation, required photos and a label bound to each serial", async () => {
  const a = await order();
  let b = await ok(
    "/api/technician/orders/" + a.id + "/draft",
    "POST",
    { version: a.version },
    ta,
    201,
  );
  assert.equal(
    (
      await req(
        "/api/technician/batches/" + b.id + "/submit",
        "POST",
        { version: b.version, serials: ["123456789012345"], confirmed: false },
        ta,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await req(
        "/api/technician/batches/" + b.id + "/submit",
        "POST",
        {
          version: b.version,
          serials: ["wrong-code"],
          confirmed: true,
          checklist_signed: true,
        },
        ta,
      )
    ).status,
    400,
  );
  await serials(["123456789012345"]);
  for (const kind of [
    "vehicle",
    "label",
    "installed",
    "inspection",
    "checklist",
  ]) {
    const p = await ok(
      "/api/technician/batches/" + b.id + "/photos",
      "POST",
      {
        version: b.version,
        kind,
        image: kind === "label" ? await photo("123456789012345") : jpg,
      },
      ta,
      201,
    );
    b.version = p.version;
    assert.equal(
      (await req("/api/technician/evidence/" + p.id, "GET", undefined, tb))
        .status,
      404,
    );
  }
  assert.equal(
    (
      await req(
        "/api/technician/batches/" + b.id + "/submit",
        "POST",
        { version: b.version, serials: ["123456789012345"], confirmed: true },
        ta,
      )
    ).status,
    400,
  );
  const files = (
    await ok("/api/technician/orders/" + a.id, "GET", undefined, ta)
  ).submissions[0].files;
  const label = files.find((f) => f.kind === "label");
  assert.equal(label.serial_code, "123456789012345");
  assert.equal(label.equipment_type, "RASTREADOR");
  assert.equal(
    (
      await req(
        "/api/technician/photos/" + label.id,
        "PATCH",
        { version: b.version, serial_code: "another-code" },
        ta,
      )
    ).status,
    409,
  );
  await ok(
    "/api/technician/batches/" + b.id + "/submit",
    "POST",
    {
      version: b.version,
      serials: ["123456789012345"],
      confirmed: true,
      checklist_signed: true,
    },
    ta,
  );
  assert.equal(
    (
      await req(
        "/api/technician/photos/" + label.id,
        "PATCH",
        { version: b.version + 1, serial_code: "other" },
        ta,
      )
    ).status,
    409,
  );
  assert.equal(
    (await req("/api/batches/" + b.id + "/approve", "POST", {}, ta)).status,
    403,
  );
  assert.equal(
    (await ok("/api/orders/" + a.id)).status,
    "AGUARDANDO CONFERÊNCIA",
  );
  assert.equal(
    (
      await spool.query(
        "SELECT count(*)::integer n FROM zencontrol_installations",
      )
    ).rows[0].n,
    0,
  );
});
test("central approval stays pending until the genuine stock receipt and uses the original movement ledger", async () => {
  const code = "123456789012346";
  await serials([code]);
  const a = await order(),
    b = await submission(a, [code]);
  const r = await approve(b);
  assert.equal(r.status, "AGUARDANDO ESTOQUE");
  assert.equal((await ok("/api/orders/" + a.id)).completed_at, "");
  const finance =
    "/api/finance/preview?technician_id=" +
    tida +
    "&start=2020-01-01&end=2099-12-31";
  assert.ok(!(await ok(finance)).orders.some((row) => row.id === a.id));
  assert.equal(
    (
      await req("/api/batches/" + b.id + "/approve", "POST", {
        version: b.version,
        order_version: b.current_order.version,
        serials: [code],
        reason: "Conferência repetida",
      })
    ).status,
    409,
  );
  assert.equal(await runOne(pool, cfg), true);
  const done = await ok("/api/orders/" + a.id);
  assert.equal(done.status, "CONCLUÍDO");
  assert.equal(done.stock_sync_state, "confirmed");
  assert.ok((await ok(finance)).orders.some((row) => row.id === a.id));
  assert.ok(done.stock_receipt.receipt_id);
  const item = (
    await spool.query(
      "SELECT * FROM equipamentos_seriais WHERE codigo_serial=$1",
      [code],
    )
  ).rows[0];
  assert.equal(item.status, "INSTALADO");
  assert.equal(
    (
      await spool.query(
        "SELECT count(*)::integer n FROM eventos_seriais e JOIN movimentacoes m ON m.id=e.movimentacao_id WHERE e.codigo_serial=$1 AND m.tipo='USO_FINAL'",
        [code],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await req("/api/orders/" + a.id + "/reopen", "POST", {
        reason: "Reabertura indevida",
        version: done.version,
      })
    ).status,
    409,
  );
});
test("wrong technician load causes an atomic refusal and correction remains possible", async () => {
  const code = "123456789012347";
  await serials([code]);
  const a = await order(),
    b = await submission(a, [code]);
  await spool.query(
    "UPDATE equipamentos_seriais SET tecnico_id=$1 WHERE codigo_serial=$2",
    [stockB, code],
  );
  await approve(b);
  await runOne(pool, cfg);
  const pending = await ok("/api/orders/" + a.id);
  assert.equal(pending.status, "AGUARDANDO ESTOQUE");
  assert.equal(pending.stock_sync_state, "failed");
  assert.equal(pending.stock_receipt, null);
  const bad = await ok("/api/batches/" + b.id);
  assert.equal(bad.state, "stock_failed");
  assert.equal(
    (
      await spool.query(
        "SELECT status FROM equipamentos_seriais WHERE codigo_serial=$1",
        [code],
      )
    ).rows[0].status,
    "TECNICO",
  );
  await ok(
    "/api/batches/" + b.id + "/reject",
    "POST",
    { version: bad.version, reason: "IMEI fora da carga. Confira a etiqueta." },
    operator,
  );
  const corrected = await ok("/api/orders/" + a.id);
  assert.equal(corrected.status, "CORREÇÃO SOLICITADA");
  assert.equal(
    (await ok("/api/technician/orders/" + a.id, "GET", undefined, ta))
      .submissions[0].rejection_reason,
    "IMEI fora da carga. Confira a etiqueta.",
  );
  await ok(
    "/api/technician/orders/" + a.id + "/draft",
    "POST",
    { version: corrected.version },
    ta,
    201,
  );
});
test("lost HTTP response is retried with the same key and produces exactly one installation", async () => {
  const code = "123456789012348";
  await serials([code]);
  const a = await order(),
    b = await submission(a, [code]);
  await approve(b);
  const client = new StockClient(cfg);
  await runOne(pool, cfg, {
    stock: {
      install: async (p, key) => {
        await client.install(p, key);
        throw new StockError(
          "Conexão interrompida após confirmação externa.",
          true,
        );
      },
    },
  });
  assert.equal((await ok("/api/orders/" + a.id)).status, "AGUARDANDO ESTOQUE");
  const j = (
    await pool.query(
      "SELECT * FROM zc_jobs WHERE order_id=$1 AND kind='stock_installation'",
      [a.id],
    )
  ).rows[0];
  assert.equal(j.state, "pending");
  await pool.query("UPDATE zc_jobs SET available_at=0 WHERE id=$1", [j.id]);
  await runOne(pool, cfg);
  assert.equal((await ok("/api/orders/" + a.id)).status, "CONCLUÍDO");
  assert.equal(
    (
      await spool.query(
        "SELECT count(*)::integer n FROM zencontrol_installations WHERE order_id=$1",
        [a.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await spool.query(
        "SELECT count(*)::integer n FROM eventos_seriais WHERE codigo_serial=$1 AND status_novo='INSTALADO'",
        [code],
      )
    ).rows[0].n,
    1,
  );
});
test("non-installation service requires the central but never calls stock installation", async () => {
  const a = await order("Manutenção"),
    before = (
      await spool.query(
        "SELECT count(*)::integer n FROM zencontrol_installations",
      )
    ).rows[0].n,
    b = await submission(a, [], "none");
  assert.equal(
    (await ok("/api/orders/" + a.id)).status,
    "AGUARDANDO CONFERÊNCIA",
  );
  await approve(b);
  assert.equal((await ok("/api/orders/" + a.id)).status, "CONCLUÍDO");
  assert.equal(
    (
      await spool.query(
        "SELECT count(*)::integer n FROM zencontrol_installations",
      )
    ).rows[0].n,
    before,
  );
});
test("stock boundary enforces authentication, request identity, atomic batches and concurrent idempotency", async () => {
  const code = "123456789012349";
  await serials([code]);
  const payload = {
    source_system: "direct-test",
    order_id: "OS-test-atomic",
    submission_id: "submission-test",
    technician_id: stockA,
    serials: [code, "unknown-imei"],
    operator: "Central",
  };
  const key = "stock:direct:atomic-request";
  assert.equal((await stockRequest(payload, key, "invalid")).status, 401);
  assert.equal((await stockRequest(payload, key)).status, 409);
  assert.equal(
    (
      await spool.query(
        "SELECT status FROM equipamentos_seriais WHERE codigo_serial=$1",
        [code],
      )
    ).rows[0].status,
    "TECNICO",
  );
  payload.serials = [code];
  const results = await Promise.all([
    stockRequest(payload, key),
    stockRequest(payload, key),
  ]);
  assert.ok(
    results.every((r) => r.status === 200),
    JSON.stringify(results),
  );
  assert.equal(results[0].data.receipt_id, results[1].data.receipt_id);
  assert.equal(
    (await stockRequest({ ...payload, operator: "Changed" }, key)).status,
    409,
  );
  assert.equal((await stockRequest(payload, key + "-new")).status, 409);
});
test("stale order versions and changed assignments cannot be submitted or approved", async () => {
  const a = await order(),
    b = await ok(
      "/api/technician/orders/" + a.id + "/draft",
      "POST",
      { version: a.version },
      ta,
      201,
    ),
    fresh = await ok("/api/orders/" + a.id);
  await ok("/api/orders/" + a.id, "PATCH", {
    version: fresh.version,
    technician_id: tidb,
    vehicle: a.vehicle,
    service: a.service,
    customer_name: "Updated",
    scheduled_at: a.scheduled_at,
  });
  assert.equal(
    (
      await req(
        "/api/technician/batches/" + b.id + "/photos",
        "POST",
        { version: b.version, kind: "vehicle", image: jpg },
        ta,
      )
    ).status,
    404,
  );
  const assigned = await ok(
    "/api/technician/orders/" + a.id,
    "GET",
    undefined,
    tb,
  );
  const replacement = await ok(
    "/api/technician/orders/" + a.id + "/draft",
    "POST",
    { version: assigned.order.version },
    tb,
    201,
  );
  assert.notEqual(replacement.id, b.id);
});

test("stock installation groups models while preserving a single atomic receipt", async () => {
  const model = (
    await spool.query(
      "INSERT INTO produtos(nome,categoria) VALUES('Segundo modelo','TAG') RETURNING id",
    )
  ).rows[0].id;
  const one = "multi-model-001",
    two = "multi-model-002";
  await serials([one]);
  await serials([two], stockA, model);
  const payload = {
    source_system: "mixed-test",
    order_id: "OS-MIXED-MODELS",
    submission_id: "mixed-submission",
    technician_id: stockA,
    serials: [one, two],
    operator: "Central",
  };
  const r = await stockRequest(payload, "stock:mixed:models-001");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.serials.length, 2);
  assert.equal(
    (
      await spool.query(
        "SELECT count(*)::integer n FROM equipamentos_seriais WHERE codigo_serial=ANY($1::text[]) AND status='INSTALADO'",
        [[one, two]],
      )
    ).rows[0].n,
    2,
  );
});

test("technician downloads only the assigned masked OS, even with an integral query", async () => {
  const { readPdf } = require("./helpers/pdf.cjs"),
    fixture = require("./fixtures/order-document.cjs");
  const a = await order();
  await ok("/api/orders/" + a.id, "PATCH", {
    version: a.version,
    document_data: fixture.document_data,
  });
  const pdf = await ok(
    "/api/technician/orders/" + a.id + "/pdf?integral=1",
    "GET",
    undefined,
    ta,
  );
  const parsed = await readPdf(pdf);
  assert.ok(parsed.text.includes("DADOS DO ASSOCIADO"));
  assert.ok(!parsed.text.includes(fixture.document_data.cpf_cnpj));
  assert.ok(parsed.text.includes("portal do técnico"));
  assert.equal(
    (await req("/api/technician/orders/" + a.id + "/pdf", "GET", undefined, tb))
      .status,
    404,
  );
});

test("unreadable or wrong-load equipment photo cannot be replaced by a typed IMEI and creates no evidence", async () => {
  const a = await order();
  const b = await ok(
    "/api/technician/orders/" + a.id + "/draft",
    "POST",
    { version: a.version },
    ta,
    201,
  );
  const objectsBefore = remote.state.objects.size;
  for (const image of [jpg, await photo("not-in-load", "QRCode")]) {
    const r = await req(
      "/api/technician/batches/" + b.id + "/photos",
      "POST",
      {
        version: b.version,
        kind: "label",
        image,
        serial_code: "123456789012345",
      },
      ta,
    );
    assert.equal(r.status, 400);
    assert.match(r.data.error, /ilegível|não corresponde/);
  }
  const own = await ok("/api/technician/orders/" + a.id, "GET", undefined, ta);
  assert.equal(own.submissions[0].version, b.version);
  assert.equal(own.submissions[0].files.length, 0);
  assert.equal(remote.state.objects.size, objectsBefore);
});

test("QR photograph automatically identifies a TAG and binds its serial without scanning or typing", async () => {
  const model = (
    await spool.query(
      "INSERT INTO produtos(nome,categoria) VALUES('TAG de teste portal','TAG') RETURNING id",
    )
  ).rows[0].id;
  await serials(["TAG-PORTAL-0001"], stockA, model);
  const a = await order();
  const b = await ok(
    "/api/technician/orders/" + a.id + "/draft",
    "POST",
    { version: a.version },
    ta,
    201,
  );
  const result = await ok(
    "/api/technician/batches/" + b.id + "/photos",
    "POST",
    {
      version: b.version,
      kind: "label",
      image: await photo(
        JSON.stringify({ serial: "TAG-PORTAL-0001" }),
        "QRCode",
      ),
    },
    ta,
    201,
  );
  assert.equal(result.equipment_type, "TAG");
  assert.equal(result.serial_code, "TAG-PORTAL-0001");
  const detail = await ok(
    "/api/technician/orders/" + a.id,
    "GET",
    undefined,
    ta,
  );
  assert.equal(detail.submissions[0].files[0].serial_code, result.serial_code);
  assert.ok(detail.document.customer);
  assert.equal(detail.document.service, a.service);
});

test("signed checklist PDF is private and required before submission and central payment release", async () => {
  const a = await order("Manutenção");
  const b = await ok(
    "/api/technician/orders/" + a.id + "/draft",
    "POST",
    { version: a.version },
    ta,
    201,
  );
  for (const kind of ["vehicle", "service", "inspection"]) {
    const r = await ok(
      "/api/technician/batches/" + b.id + "/photos",
      "POST",
      { version: b.version, kind, image: jpg },
      ta,
      201,
    );
    b.version = r.version;
  }
  const submitBody = () => ({
    version: b.version,
    serials: [],
    confirmed: true,
    checklist_signed: true,
  });
  const pending = await req(
    "/api/technician/batches/" + b.id + "/submit",
    "POST",
    submitBody(),
    ta,
  );
  assert.equal(pending.status, 400);
  assert.match(pending.data.error, /checklist/i);
  const invalid = await req(
    "/api/technician/batches/" + b.id + "/photos",
    "POST",
    {
      version: b.version,
      kind: "checklist",
      image:
        "data:application/pdf;base64," +
        Buffer.from("%PDF-invalid").toString("base64"),
    },
    ta,
  );
  assert.equal(invalid.status, 400);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const pdfBytes = Buffer.from(await pdf.save());
  const file = await ok(
    "/api/technician/batches/" + b.id + "/photos",
    "POST",
    {
      version: b.version,
      kind: "checklist",
      image: "data:application/pdf;base64," + pdfBytes.toString("base64"),
    },
    ta,
    201,
  );
  b.version = file.version;
  const downloaded = await ok(
    "/api/technician/evidence/" + file.id,
    "GET",
    undefined,
    ta,
  );
  assert.deepEqual(downloaded, pdfBytes);
  assert.equal(
    (await req("/api/technician/evidence/" + file.id, "GET", undefined, tb))
      .status,
    404,
  );
  assert.equal(
    (
      await req(
        "/api/technician/batches/" + b.id + "/submit",
        "POST",
        { ...submitBody(), checklist_signed: false },
        ta,
      )
    ).status,
    400,
  );
  await ok(
    "/api/technician/batches/" + b.id + "/submit",
    "POST",
    submitBody(),
    ta,
  );
  const finance =
    "/api/finance/preview?technician_id=" +
    tida +
    "&start=2020-01-01&end=2099-12-31";
  assert.ok(!(await ok(finance)).orders.some((row) => row.id === a.id));
  const review = await ok("/api/batches/" + b.id);
  const centralBody = {
    version: review.version,
    order_version: review.current_order.version,
    reason: "Arquivo e assinatura conferidos.",
    serials: [],
  };
  assert.equal(
    (
      await req(
        "/api/batches/" + b.id + "/approve",
        "POST",
        centralBody,
        operator,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await req(
        "/api/evidence/" + file.id + "/classify",
        "PATCH",
        { version: review.version, kind: "other" },
        operator,
      )
    ).status,
    409,
  );
  await ok(
    "/api/batches/" + b.id + "/approve",
    "POST",
    { ...centralBody, checklist_reviewed: true },
    operator,
  );
  assert.ok((await ok(finance)).orders.some((row) => row.id === a.id));
});

test("new OS requiring tracker and TAG cannot be submitted with just one equipment type", async () => {
  const tracker = "required-tracker-001",
    tag = "required-tag-001";
  const model = (
    await spool.query(
      "INSERT INTO produtos(nome,categoria) VALUES('TAG obrigatória','TAG') RETURNING id",
    )
  ).rows[0].id;
  await serials([tracker]);
  await serials([tag], stockA, model);
  const a = await order();
  await ok("/api/orders/" + a.id, "PATCH", {
    version: a.version,
    document_data: { equipment: ["tracker", "tag"] },
  });
  const updated = await ok(
    "/api/technician/orders/" + a.id,
    "GET",
    undefined,
    ta,
  );
  const b = await ok(
    "/api/technician/orders/" + a.id + "/draft",
    "POST",
    { version: updated.order.version },
    ta,
    201,
  );
  assert.deepEqual(updated.required_equipment, { RASTREADOR: 1, TAG: 1 });
  assert.equal(updated.rule.general_photo_min, 0);
  for (const kind of ["checklist", "label"]) {
    const r = await ok(
      "/api/technician/batches/" + b.id + "/photos",
      "POST",
      {
        version: b.version,
        kind,
        image: kind === "label" ? await photo(tracker) : jpg,
      },
      ta,
      201,
    );
    b.version = r.version;
  }
  const payload = {
    version: b.version,
    serials: [tracker],
    confirmed: true,
    checklist_signed: true,
  };
  const refused = await req(
    "/api/technician/batches/" + b.id + "/submit",
    "POST",
    payload,
    ta,
  );
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /TAG/);
  const added = await ok(
    "/api/technician/batches/" + b.id + "/photos",
    "POST",
    { version: b.version, kind: "label", image: await photo(tag, "QRCode") },
    ta,
    201,
  );
  await ok(
    "/api/technician/batches/" + b.id + "/submit",
    "POST",
    { ...payload, version: added.version, serials: [tracker, tag] },
    ta,
  );
});

test("pre-upgrade submissions retain their original evidence requirements", async () => {
  const a = await order("Manutenção");
  const b = await ok(
    "/api/technician/orders/" + a.id + "/draft",
    "POST",
    { version: a.version },
    ta,
    201,
  );
  // A previously created batch has capture_version=1 after migration 004.
  await pool.query("UPDATE zc_batches SET capture_version=1 WHERE id=$1", [
    b.id,
  ]);
  for (const kind of ["vehicle", "service"]) {
    const added = await ok(
      "/api/technician/batches/" + b.id + "/photos",
      "POST",
      { version: b.version, kind, image: jpg },
      ta,
      201,
    );
    b.version = added.version;
  }
  await ok(
    "/api/technician/batches/" + b.id + "/submit",
    "POST",
    { version: b.version, serials: [], confirmed: true },
    ta,
  );
  const review = await ok("/api/batches/" + b.id);
  await ok(
    "/api/batches/" + b.id + "/approve",
    "POST",
    {
      version: review.version,
      order_version: review.current_order.version,
      serials: [],
      reason: "Conferência de registro anterior.",
    },
    operator,
  );
  assert.equal((await ok("/api/orders/" + a.id)).status, "CONCLUÍDO");
});

test("general photos have no minimum; a non-installation service can be submitted with only the signed checklist", async () => {
  const a = await order("Visita");
  const b = await ok(
    "/api/technician/orders/" + a.id + "/draft",
    "POST",
    { version: a.version },
    ta,
    201,
  );
  const detail = await ok(
    "/api/technician/orders/" + a.id,
    "GET",
    undefined,
    ta,
  );
  assert.equal(detail.rule.general_photo_min, 0);
  const file = await ok(
    "/api/technician/batches/" + b.id + "/photos",
    "POST",
    { version: b.version, kind: "checklist", image: jpg },
    ta,
    201,
  );
  await ok(
    "/api/technician/batches/" + b.id + "/submit",
    "POST",
    {
      version: file.version,
      serials: [],
      confirmed: true,
      checklist_signed: true,
    },
    ta,
  );
  const review = await ok("/api/batches/" + b.id);
  assert.equal(
    review.files.filter((f) => !["label", "checklist"].includes(f.kind)).length,
    0,
  );
  await approve(review);
  assert.equal((await ok("/api/orders/" + a.id)).status, "CONCLUÍDO");
});

test("portal accepts staff supervision and technician accounts; central accepts only staff", async () => {
  const technicianAtCentral = await req(
    "/api/auth/login",
    "POST",
    { login: "ana", password, audience: "central" },
    null,
  );
  assert.equal(technicianAtCentral.status, 403);
  assert.equal(technicianAtCentral.data.token, undefined);
  const staffAtPortal = await req(
    "/api/auth/login",
    "POST",
    { login: "central", password, audience: "technician" },
    null,
  );
  assert.equal(staffAtPortal.status, 200);
  assert.equal(staffAtPortal.data.user.papel, "operador");
  const technicianLogin = await ok(
    "/api/auth/login",
    "POST",
    { login: "ana", password, audience: "technician" },
    null,
  );
  assert.equal(technicianLogin.user.papel, "tecnico");
  assert.equal(
    (
      await req(
        "/api/finance/settlements",
        "GET",
        undefined,
        technicianLogin.token,
      )
    ).status,
    403,
  );
});

test("configured portal origin supports cross-origin authenticated uploads and old entry redirects to it", async () => {
  const target = "https://portal-tecnico.example.test";
  const allowed = await fetch(base + "/api/technician/orders", {
    headers: { Origin: target, Authorization: "Bearer " + ta },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), target);
  const preflight = await fetch(base + "/api/technician/batches/any/photos", {
    method: "OPTIONS",
    headers: {
      Origin: target,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), target);
  const unknown = await fetch(base + "/api/technician/orders", {
    headers: {
      Origin: "https://not-allowed.example.test",
      Authorization: "Bearer " + ta,
    },
  });
  assert.equal(unknown.status, 403);
  const redirect = await fetch(base + "/tecnico", { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), target);
});

test("C/D: real photo submissions persist central/technician alerts, frozen remuneration and official stock history", async () => {
  const centralInbox = await ok("/api/notifications?limit=100");
  const pending = centralInbox.items.find(
    (n) => n.title === "Novo serviço aguardando conferência.",
  );
  assert.ok(pending);
  const before = (
    await ok("/api/notifications?limit=100", "GET", undefined, operator)
  ).unread;
  await ok("/api/notifications/" + pending.id + "/read", "POST", {}, admin);
  assert.equal(
    (await ok("/api/notifications?limit=100", "GET", undefined, operator))
      .unread,
    before,
  );
  const techInbox = await ok(
    "/api/notifications?limit=100",
    "GET",
    undefined,
    ta,
  );
  assert.ok(techInbox.items.some((n) => n.title === "Serviço concluído"));
  assert.ok(techInbox.items.some((n) => n.title === "Correção solicitada"));
  const finance = await ok("/api/technician/finance", "GET", undefined, ta);
  assert.ok(
    finance.ledger.some((l) => l.state === "approved" && l.eligible_on),
  );
  const history = await ok(
    "/api/technician/stock/history",
    "GET",
    undefined,
    ta,
  );
  assert.ok(
    history.items.some((e) => e.status_novo === "INSTALADO" && e.order_id),
  );
  assert.ok(history.items.every((e) => e.codigo_serial !== "load-bruno-only"));
  const refreshed = await ok(
    "/api/notifications?limit=100",
    "GET",
    undefined,
    ta,
  );
  assert.ok(
    refreshed.items.some(
      (n) => n.title === "Equipamento recebido na sua carga",
    ),
  );
});

test("J: health check returns 503 during a database outage without leaking configuration", async () => {
  const offline = createApp(
    {
      query: async () => {
        throw Error("private-connection-details");
      },
    },
    cfg,
  ).listen(0, "127.0.0.1");
  await once(offline, "listening");
  try {
    const r = await fetch(
      "http://127.0.0.1:" + offline.address().port + "/healthz",
    );
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { status: "unavailable" });
  } finally {
    await new Promise((resolve) => offline.close(resolve));
  }
});

test("an extra tracker creates a linked, independently confirmed and paid OS; unplanned equipment cannot be counted on the principal OS", async () => {
  const d = require("../src/domain");
  await ok(
    "/api/finance-v2/technicians/" + tida + "/rates",
    "POST",
    {
      effective_on: d.today(),
      prices: Object.fromEntries(d.services.map((name) => [name, 9000])),
    },
    admin,
    201,
  );
  const mainCode = "extra-main-tracker",
    extraCode = "extra-additional-tracker",
    tagCode = "extra-main-tag";
  const tagModel = (
    await spool.query(
      "INSERT INTO produtos(nome,categoria) VALUES('TAG adicional planejada','TAG') RETURNING id",
    )
  ).rows[0].id;
  await serials([mainCode, extraCode]);
  await serials([tagCode], stockA, tagModel);
  const main = await ok(
    "/api/orders",
    "POST",
    {
      vehicle: "EXT1A23",
      customer_name: "Cliente fictício",
      service: "Instalação",
      technician_id: tida,
      scheduled_at: d.today() + "T10:00",
      document_data: { equipment: ["tracker", "tag", "tracker_extra"] },
    },
    admin,
    201,
  );
  assert.deepEqual(main.document_data.equipment, ["tracker", "tag"]);
  assert.equal(main.additional_orders.length, 1);
  const child = await ok("/api/orders/" + main.additional_orders[0].id);
  assert.equal(child.parent_order_id, main.id);
  assert.equal(child.additional_equipment, "RASTREADOR");
  assert.deepEqual(child.document_data.equipment, ["tracker"]);
  const replay = await ok("/api/orders/" + main.id, "PATCH", {
    version: main.version,
    additional: "Rastreador Extra",
  });
  assert.equal(replay.additional_orders[0].id, child.id);
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) n FROM zc_orders WHERE parent_order_id=$1",
          [main.id],
        )
      ).rows[0].n,
    ),
    1,
  );
  const ownMain = await ok(
    "/api/technician/orders/" + main.id,
    "GET",
    undefined,
    ta,
  );
  assert.deepEqual(ownMain.required_equipment, { RASTREADOR: 1, TAG: 1 });
  const ownChild = await ok(
    "/api/technician/orders/" + child.id,
    "GET",
    undefined,
    ta,
  );
  assert.deepEqual(ownChild.required_equipment, { RASTREADOR: 1, TAG: 0 });
  assert.equal(
    (await req("/api/technician/orders/" + child.id, "GET", undefined, tb))
      .status,
    404,
  );
  async function capture(order, codes, unplanned = false) {
    let batch = await ok(
      "/api/technician/orders/" + order.id + "/draft",
      "POST",
      { version: order.version },
      ta,
      201,
    );
    for (const code of codes) {
      const f = await ok(
        "/api/technician/batches/" + batch.id + "/photos",
        "POST",
        {
          version: batch.version,
          kind: "label",
          image: await photo(code, code === tagCode ? "QRCode" : "Code128"),
        },
        ta,
        201,
      );
      batch.version = f.version;
    }
    const checklist = await ok(
      "/api/technician/batches/" + batch.id + "/photos",
      "POST",
      { version: batch.version, kind: "checklist", image: jpg },
      ta,
      201,
    );
    batch.version = checklist.version;
    const payload = {
      version: batch.version,
      serials: codes,
      confirmed: true,
      checklist_signed: true,
    };
    if (unplanned) {
      const refused = await req(
        "/api/technician/batches/" + batch.id + "/submit",
        "POST",
        payload,
        ta,
      );
      assert.equal(refused.status, 400);
      assert.match(refused.data.error, /OS de equipamento adicional/);
      return batch;
    }
    await ok(
      "/api/technician/batches/" + batch.id + "/submit",
      "POST",
      payload,
      ta,
    );
    const review = await ok("/api/batches/" + batch.id);
    await approve(review);
    return batch;
  }
  const wrong = await capture(main, [mainCode, tagCode, extraCode], true);
  const details = await ok(
    "/api/technician/orders/" + main.id,
    "GET",
    undefined,
    ta,
  );
  const unwanted = details.submissions[0].files.find(
    (f) => f.serial_code === extraCode,
  );
  await ok(
    "/api/technician/photos/" + unwanted.id,
    "DELETE",
    { version: wrong.version },
    ta,
  );
  const refreshed = await ok(
    "/api/technician/orders/" + main.id,
    "GET",
    undefined,
    ta,
  );
  const ready = refreshed.submissions[0];
  await ok(
    "/api/technician/batches/" + ready.id + "/submit",
    "POST",
    {
      version: ready.version,
      serials: [mainCode, tagCode],
      confirmed: true,
      checklist_signed: true,
    },
    ta,
  );
  await approve(await ok("/api/batches/" + ready.id));
  await capture(child, [extraCode]);
  for (let i = 0; i < 25; i++) {
    if (
      (await ok("/api/orders/" + main.id)).status === "CONCLUÍDO" &&
      (await ok("/api/orders/" + child.id)).status === "CONCLUÍDO"
    )
      break;
    assert.equal(await runOne(pool, cfg), true);
  }
  for (const id of [main.id, child.id])
    assert.equal((await ok("/api/orders/" + id)).status, "CONCLUÍDO");
  const ledger = (
    await pool.query(
      "SELECT order_id,total_cents,state FROM zc_financial_ledger WHERE order_id=ANY($1::text[])",
      [[main.id, child.id]],
    )
  ).rows;
  assert.equal(ledger.length, 2);
  assert.ok(
    ledger.every((x) => x.state === "approved" && x.total_cents === 9000),
  );
  const receipts = (
    await spool.query(
      "SELECT order_id,result->'serials' AS serials FROM zencontrol_installations WHERE order_id=ANY($1::text[])",
      [[main.id, child.id]],
    )
  ).rows;
  assert.equal(receipts.length, 2);
  assert.deepEqual(
    receipts.find((r) => r.order_id === main.id).serials.sort(),
    [mainCode, tagCode].sort(),
  );
  assert.deepEqual(receipts.find((r) => r.order_id === child.id).serials, [
    extraCode,
  ]);
});
