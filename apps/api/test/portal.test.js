const { test, before, after } = require("node:test");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events");
const sharp = require("sharp");
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
  password = "test-only-password-123456789";
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
    ? ["vehicle", "label", "installed"]
    : ["vehicle", "service"]) {
    const r = await ok(
      "/api/technician/batches/" + b.id + "/photos",
      "POST",
      {
        version: b.version,
        kind,
        serial_code: kind === "label" ? codes[0] : "",
        image: jpg,
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
  if (server) await new Promise((r) => server.close(r));
  if (ss) await new Promise((r) => ss.close(r));
  if (db) await db.close();
  if (sdb) await sdb.close();
  if (folder) await fs.rm(folder, { recursive: true, force: true });
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
        { version: b.version, serials: ["123456789012345"], confirmed: true },
        ta,
      )
    ).status,
    400,
  );
  for (const kind of ["vehicle", "label", "installed"]) {
    const p = await ok(
      "/api/technician/batches/" + b.id + "/photos",
      "POST",
      { version: b.version, kind, image: jpg },
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
  await ok(
    "/api/technician/photos/" + label.id,
    "PATCH",
    { version: b.version, serial_code: "123456789012345" },
    ta,
  );
  b.version++;
  await ok(
    "/api/technician/batches/" + b.id + "/submit",
    "POST",
    { version: b.version, serials: ["123456789012345"], confirmed: true },
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
    "AGUARDANDO VALIDAÇÃO",
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
  await serials([code], stockB);
  const a = await order(),
    b = await submission(a, [code]);
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
    "AGUARDANDO VALIDAÇÃO",
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
