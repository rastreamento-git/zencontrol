const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const sharp = require("sharp");
const { randomUUID } = require("node:crypto");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const { createApp } = require("../src/app");
const { configuration } = require("../src/config");
const d = require("../src/domain"),
  o = require("../src/orders"),
  f = require("../src/finance-engine");
const { transaction } = require("../src/database");
const { orderDocument } = require("../src/order-document");
let db, pool, server, base, folder, admin, tech, tid, jpg;
const password = "waiver-test-only-password",
  secret = "waiver-test-only-secret-123456789012345";
async function req(route, method = "GET", body, token = admin, status = 200) {
  const res = await fetch(base + "/api" + route, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  assert.equal(res.status, status, JSON.stringify(data));
  return data;
}
async function create(extra = {}) {
  return req(
    "/orders",
    "POST",
    {
      vehicle: "ZEN1A23",
      customer_name: "Cliente fictício",
      service: "Instalação",
      technician_id: tid,
      scheduled_at: d.today() + "T10:00",
      ...extra,
    },
    admin,
    201,
  );
}
before(async () => {
  db = await testDatabase();
  pool = db.pool;
  await migrate(pool);
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "zen-waiver-"));
  const app = createApp(
    pool,
    configuration({
      NODE_ENV: "test",
      APP_PASSWORD: password,
      SESSION_SECRET: secret,
      ZEN_WEBHOOK_SECRET: secret,
      ZEN_DATA_DIR: folder,
    }),
  );
  await app.locals.ready();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
  admin = (await req("/auth/login", "POST", { login: "admin", password }))
    .token;
  const t = await req("/technicians", "POST", {
    name: "Técnico Dispensa",
    price_install: "90",
    price_visit: "30",
  });
  tid = t.id;
  await req("/auth/activate", "POST", {
    login: t.access.login,
    password: "zen123",
    code: t.access.code,
    new_password: password,
  });
  tech = (
    await req("/auth/login", "POST", {
      login: t.access.login,
      password,
      audience: "technician",
    })
  ).token;
  jpg = (
    await sharp({
      create: { width: 30, height: 30, channels: 3, background: "#123456" },
    })
      .jpeg()
      .toBuffer()
  ).toString("base64");
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});
test("dispensa é uma opção booleana da central, persistida e auditada, sem alterar OS anteriores", async () => {
  const normal = await create();
  assert.equal(normal.tracker_waiver_authorized, false);
  await create({ tracker_waiver_authorized: true });
  await req(
    "/orders",
    "POST",
    {
      vehicle: "ZEN1A23",
      customer_name: "Inválido",
      service: "Visita",
      tracker_waiver_authorized: "false",
    },
    admin,
    400,
  );
  const changed = await req("/orders/" + normal.id, "PATCH", {
    version: normal.version,
    tracker_waiver_authorized: true,
  });
  assert.equal(changed.tracker_waiver_authorized, true);
  const detail = await req(
    "/technician/orders/" + normal.id,
    "GET",
    undefined,
    tech,
  );
  assert.equal(detail.order.tracker_waiver_authorized, true);
  assert.equal(detail.rule.stock_action, "none");
  assert.equal(detail.rule.min_serials, 0);
  assert.deepEqual(detail.required_equipment, { RASTREADOR: 0, TAG: 0 });
  assert.match(
    detail.document.instructions,
    /DISPENSA DE RASTREADOR AUTORIZADA/,
  );
  await req(
    "/orders/" + normal.id,
    "PATCH",
    { version: changed.version, tracker_waiver_authorized: false },
    tech,
    403,
  );
  const audit = await d.rows(
    pool,
    "SELECT detail FROM zc_audit WHERE entity_id=$1 AND action='updated'",
    [normal.id],
  );
  assert.ok(JSON.stringify(audit).includes("tracker_waiver_authorized"));
});
test("dispensa conclui com vistoria, checklist assinado e conferência, sem instalação ou lançamento financeiro", async () => {
  const order = await create({
    tracker_waiver_authorized: true,
    document_data: { equipment: ["tracker"] },
  });
  let batch = await req(
    "/technician/orders/" + order.id + "/draft",
    "POST",
    { version: order.version },
    tech,
    201,
  );
  const send = () => ({
    version: batch.version,
    serials: [],
    confirmed: true,
    checklist_signed: true,
    executed_on: d.today(),
    notes: "Dispensa autorizada pela central.",
  });
  await req(
    "/technician/batches/" + batch.id + "/submit",
    "POST",
    send(),
    tech,
    400,
  );
  for (const kind of ["vehicle", "inspection", "checklist"]) {
    const result = await req(
      "/technician/batches/" + batch.id + "/photos",
      "POST",
      { version: batch.version, kind, image: jpg },
      tech,
      201,
    );
    batch.version = result.version;
  }
  await req(
    "/technician/batches/" + batch.id + "/submit",
    "POST",
    { ...send(), serials: ["123456789012345"] },
    tech,
    400,
  );
  await req(
    "/technician/batches/" + batch.id + "/submit",
    "POST",
    { ...send(), checklist_signed: false },
    tech,
    400,
  );
  await req(
    "/technician/batches/" + batch.id + "/submit",
    "POST",
    send(),
    tech,
  );
  batch = await req("/batches/" + batch.id);
  const input = {
    version: batch.version,
    order_version: batch.current_order.version,
    reason: "Dispensa e documentos conferidos.",
    serials: [],
    checklist_reviewed: true,
  };
  await req(
    "/batches/" + batch.id + "/approve",
    "POST",
    { ...input, checklist_reviewed: false },
    admin,
    400,
  );
  const result = await req("/batches/" + batch.id + "/approve", "POST", input);
  assert.equal(result.status, "CONCLUÍDO");
  const saved = await o.get(pool, order.id);
  assert.equal(saved.tracker_waiver_authorized, true);
  assert.equal(
    await d.one(pool, "SELECT 1 FROM zc_financial_ledger WHERE order_id=$1", [
      order.id,
    ]),
    null,
  );
  assert.equal(
    await d.one(
      pool,
      "SELECT 1 FROM zc_jobs WHERE order_id=$1 AND kind='stock_installation'",
      [order.id],
    ),
    null,
  );
  assert.match(orderDocument(saved).returnInstructions, /não gera remuneração/);
  assert.equal(
    (await req("/finance-v2/reconcile")).missing_ledgers.some(
      (x) => x.id === order.id,
    ),
    false,
  );
  await req(
    "/orders/" + order.id,
    "PATCH",
    { version: saved.version, tracker_waiver_authorized: false },
    admin,
    409,
  );
});
test("dispensa exclui base, adicionais e ajustes dos dois cálculos e do extrato; desmarcar antes da conclusão restaura composição", async () => {
  const order = await create();
  await pool.query(
    "INSERT INTO zc_order_extras(order_id,type,description,amount_cents) VALUES($1,'other','Adicional de teste',1500)",
    [order.id],
  );
  await transaction(pool, async (db) => {
    await f.capture(db, order, d.today());
    await db.query(
      "INSERT INTO zc_adjustments(id,order_id,amount_cents,reason,created_by) VALUES($1,$2,250,$3,$4)",
      [randomUUID(), order.id, "Ajuste de teste", "test"],
    );
  });
  const before = await f.summary(pool, tid);
  assert.equal(before.estimated_cents, 10750);
  const changed = await req("/orders/" + order.id, "PATCH", {
    version: order.version,
    tracker_waiver_authorized: true,
  });
  assert.equal(
    await transaction(pool, (db) => f.capture(db, changed, d.today())),
    null,
  );
  let summary = await f.summary(pool, tid);
  assert.equal(summary.estimated_cents, 0);
  assert.equal(
    summary.ledger.some((x) => x.order_id === order.id),
    false,
  );
  assert.equal(summary.adjustments.length, 0);
  let restored = await req("/orders/" + order.id, "PATCH", {
    version: changed.version,
    tracker_waiver_authorized: false,
  });
  assert.equal((await f.summary(pool, tid)).estimated_cents, 10750);
  restored = await req("/orders/" + order.id, "PATCH", {
    version: restored.version,
    tracker_waiver_authorized: true,
  });
  // A historical preexisting composition must never leak into either closing calculation.
  await pool.query(
    "UPDATE zc_orders SET status='CONCLUÍDO',completed_at=$2 WHERE id=$1",
    [order.id, d.today()],
  );
  await pool.query(
    "UPDATE zc_financial_ledger SET state='approved',eligible_on=$2 WHERE order_id=$1",
    [order.id, d.today()],
  );
  const normal = await create({ service: "Visita" });
  await transaction(pool, async (db) => {
    await f.capture(db, normal, d.today());
    await db.query(
      "UPDATE zc_orders SET status='CONCLUÍDO',completed_at=$2 WHERE id=$1",
      [normal.id, d.today()],
    );
    await f.makeEligible(db, await o.get(db, normal.id));
  });
  const p = await f.preview(pool, tid, d.today(), d.today());
  assert.deepEqual(
    p.orders.map((x) => x.id),
    [normal.id],
  );
  assert.equal(p.total_cents, 3000);
  const legacy = await o.financial(pool, tid, d.today(), d.today());
  assert.deepEqual(
    legacy.orders.map((x) => x.id),
    [normal.id],
  );
  assert.equal(legacy.total_cents, 3000);
  summary = await f.summary(pool, tid);
  assert.equal(summary.confirmed_cents, 3000);
  // Closed historical data cannot be edited retroactively, even for a legacy OS.
  await pool.query("UPDATE zc_orders SET workflow_mode='legacy' WHERE id=$1", [
    normal.id,
  ]);
  const closing = await transaction(pool, (db) =>
    f.createClosing(
      db,
      {
        technician_id: tid,
        start: d.today(),
        end: d.today(),
        extraordinary: true,
        reason: "Fechamento de teste",
        request_key: randomUUID(),
        preview_hash: f.digest(p),
      },
      "test",
    ),
  );
  await req(
    "/orders/" + normal.id,
    "PATCH",
    { version: normal.version, tracker_waiver_authorized: true },
    admin,
    409,
  );
  assert.equal(
    (
      await d.one(pool, "SELECT total_cents FROM zc_settlements WHERE id=$1", [
        closing.id,
      ])
    ).total_cents,
    3000,
  );
});
