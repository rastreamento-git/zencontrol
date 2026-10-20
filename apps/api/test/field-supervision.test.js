const { test, before, after } = require("node:test");
const assert = require("node:assert/strict"),
  { once } = require("node:events");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const sharp = require("sharp");
const { testDatabase } = require("./helpers/database.cjs"),
  { migrate } = require("../scripts/migrate");
const { createApp } = require("../src/app"),
  { configuration } = require("../src/config");
const d = require("../src/domain"),
  f = require("../src/finance-engine"),
  { transaction } = require("../src/database");
const { randomUUID } = require("node:crypto");
let db,
  pool,
  server,
  base,
  folder,
  admin,
  operator,
  tech,
  a,
  b,
  orderA,
  orderB,
  image,
  adminId,
  operatorId;
const password = "Field1!test",
  secret = "field-supervision-test-secret-123456789012345";
async function req(
  route,
  method = "GET",
  body,
  token = admin,
  target,
  expected = 200,
) {
  const res = await fetch(base + "/api" + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      ...(target !== undefined
        ? { "X-Zen-Technician-Id": String(target) }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  let data;
  try {
    data = JSON.parse(bytes);
  } catch {
    data = bytes;
  }
  assert.equal(res.status, expected, JSON.stringify(data));
  return data;
}
async function create(tid, vehicle) {
  return req(
    "/orders",
    "POST",
    {
      vehicle,
      customer_name: "Cliente fictício",
      service: "Visita",
      technician_id: tid,
      scheduled_at: d.today() + "T10:00",
    },
    admin,
    undefined,
    201,
  );
}
before(async () => {
  db = await testDatabase();
  pool = db.pool;
  await migrate(pool);
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "zen-field-supervision-"));
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
  let login = await req("/auth/login", "POST", { login: "admin", password });
  admin = login.token;
  adminId = login.user.id;
  const op = await req("/users", "POST", {
    login: "operador.supervisao",
    nome: "Operador de supervisão",
    papel: "operador",
    password,
  });
  operatorId = op.id;
  operator = (
    await req("/auth/login", "POST", { login: "operador.supervisao", password })
  ).token;
  a = await req("/technicians", "POST", {
    name: "Ana Técnica",
    price_visit: "35",
  });
  b = await req("/technicians", "POST", {
    name: "Bruno Técnico",
    price_visit: "50",
  });
  await req("/auth/activate", "POST", {
    login: a.access.login,
    password: "zen123",
    code: a.access.code,
    new_password: password,
  });
  tech = (
    await req("/auth/login", "POST", {
      login: a.access.login,
      password,
      audience: "technician",
    })
  ).token;
  orderA = await create(a.id, "SUP1A23");
  orderB = await create(b.id, "SUP2B34");
  image = (
    await sharp({
      create: { width: 30, height: 30, channels: 3, background: "#123456" },
    })
      .jpeg()
      .toBuffer()
  ).toString("base64");
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  if (db) await db.close();
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});
test("staff can list technicians, must select an active environment, and retain their real identities", async () => {
  for (const token of [admin, operator]) {
    const list = await req("/field/technicians", "GET", undefined, token);
    assert.deepEqual(
      list.items.map((t) => t.id),
      [a.id, b.id],
    );
    await req("/technician/me", "GET", undefined, token, undefined, 400);
    await req("/technician/me", "GET", undefined, token, "1 OR 1=1", 400);
    await req("/technician/me", "GET", undefined, token, 999999, 404);
    const opened = await req("/technician/context", "POST", {}, token, b.id);
    assert.equal(opened.id, b.id);
    assert.ok(["admin", "operador"].includes(opened.actor.papel));
    const me = await req("/technician/me", "GET", undefined, token, b.id);
    assert.equal(me.id, b.id);
    assert.notEqual(me.user.papel, "tecnico");
    assert.equal(
      (await req("/auth/session", "GET", undefined, token, b.id)).user.id,
      me.user.id,
    );
    for (const route of [
      "/users",
      "/settings",
      "/finance-v2/technicians/" + a.id,
    ])
      await req(route, "GET", undefined, token);
  }
});
test("technicians cannot select another environment or obtain staff functions", async () => {
  await req("/field/technicians", "GET", undefined, tech, undefined, 403);
  await req("/technician/me", "GET", undefined, tech, a.id, 403);
  await req(
    "/technician/orders/" + orderB.id,
    "GET",
    undefined,
    tech,
    undefined,
    404,
  );
  assert.equal((await req("/technician/me", "GET", undefined, tech)).id, a.id);
  for (const route of ["/users", "/settings", "/audit", "/finance/settlements"])
    await req(route, "GET", undefined, tech, undefined, 403);
});
test("simultaneous requests for different technicians never share a selected environment", async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) => {
      const id = i % 2 ? a.id : b.id;
      return req("/technician/orders", "GET", undefined, operator, id).then(
        (r) => ({ id, items: r.items }),
      );
    }),
  );
  for (const r of results)
    assert.deepEqual(
      r.items.map((o) => o.id),
      [r.id === a.id ? orderA.id : orderB.id],
    );
  await req(
    "/technician/orders/" + orderB.id,
    "GET",
    undefined,
    admin,
    a.id,
    404,
  );
  assert.equal((await req("/technician/me", "GET", undefined, tech)).id, a.id);
});
test("central can execute a technician service; ownership, source identity, audit, approval and finance stay correct", async () => {
  let batch = await req(
    "/technician/orders/" + orderA.id + "/draft",
    "POST",
    { version: orderA.version },
    operator,
    a.id,
    201,
  );
  const stored = await d.one(pool, "SELECT * FROM zc_batches WHERE id=$1", [
    batch.id,
  ]);
  assert.equal(stored.source_user_id, operatorId);
  assert.equal(stored.technician_id, a.id);
  for (const kind of ["vehicle", "service", "inspection", "checklist"]) {
    const r = await req(
      "/technician/batches/" + batch.id + "/photos",
      "POST",
      { version: batch.version, kind, image },
      operator,
      a.id,
      201,
    );
    batch.version = r.version;
  }
  await req(
    "/technician/batches/" + batch.id,
    "PATCH",
    { version: batch.version, notes: "Registro direto pela central." },
    operator,
    b.id,
    404,
  );
  await req(
    "/technician/batches/" + batch.id,
    "PATCH",
    { version: batch.version, notes: "Registro direto pela central." },
    operator,
    a.id,
  );
  batch.version++;
  await req(
    "/technician/batches/" + batch.id + "/submit",
    "POST",
    {
      version: batch.version,
      serials: [],
      confirmed: true,
      checklist_signed: true,
      executed_on: d.today(),
      notes: "Vistoria conferida pela operação.",
    },
    operator,
    a.id,
  );
  const review = await req("/batches/" + batch.id);
  await req(
    "/batches/" + batch.id + "/approve",
    "POST",
    {
      version: review.version,
      order_version: review.current_order.version,
      checklist_reviewed: true,
      reason: "Evidências e checklist conferidos.",
    },
    operator,
  );
  assert.equal((await req("/orders/" + orderA.id)).status, "CONCLUÍDO");
  const ledger = await d.one(
    pool,
    "SELECT * FROM zc_financial_ledger WHERE order_id=$1",
    [orderA.id],
  );
  assert.equal(ledger.technician_id, a.id);
  assert.equal(ledger.total_cents, 3500);
  const audit = await d.rows(
    pool,
    "SELECT * FROM zc_audit WHERE entity_type='batch' AND entity_id=$1 ORDER BY id",
    [batch.id],
  );
  for (const event of [
    "portal_draft",
    "portal_photo_added",
    "portal_draft_updated",
    "portal_submitted",
  ]) {
    const rows = audit.filter((x) => x.action === event);
    assert.ok(rows.length, event);
    for (const row of rows) {
      assert.equal(row.actor, "Operador de supervisão");
      assert.equal(row.detail.delegation.actor_user_id, operatorId);
      assert.equal(row.detail.delegation.technician_id, a.id);
    }
  }
});
test("technician financial documents and notifications remain scoped during staff supervision", async () => {
  const p = await f.preview(pool, a.id, d.today(), d.today());
  const closing = await transaction(pool, (db) =>
    f.createClosing(
      db,
      {
        technician_id: a.id,
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
    "/finance-v2/closings/" + closing.id + "/export",
    "GET",
    undefined,
    operator,
    b.id,
    404,
  );
  const view = await req(
    "/finance-v2/closings/" + closing.id + "/export",
    "GET",
    undefined,
    operator,
    a.id,
  );
  assert.equal(view.snapshot.technician.id, a.id);
  const notifications = await req(
    "/notifications",
    "GET",
    undefined,
    operator,
    a.id,
  );
  assert.ok(notifications.items.length);
  for (const n of notifications.items)
    assert.equal(
      (
        await d.one(
          pool,
          "SELECT technician_id FROM zc_notifications WHERE id=$1",
          [n.id],
        )
      ).technician_id,
      a.id,
    );
  const id = notifications.items[0].id;
  await req("/notifications/" + id + "/read", "POST", {}, operator, b.id, 404);
  await req("/notifications/" + id + "/read", "POST", {}, operator, a.id);
  assert.ok(
    await d.one(
      pool,
      "SELECT 1 FROM zc_notification_reads WHERE notification_id=$1 AND user_id=$2",
      [id, operatorId],
    ),
  );
  assert.equal(
    await d.one(
      pool,
      "SELECT 1 FROM zc_notification_reads r JOIN zc_technician_accounts a ON a.user_id=r.user_id WHERE notification_id=$1",
      [id],
    ),
    null,
  );
});
test("deactivating the selected technician revokes further delegated operations immediately", async () => {
  await pool.query("UPDATE zc_technicians SET active=false WHERE id=$1", [
    b.id,
  ]);
  await req("/technician/orders", "GET", undefined, operator, b.id, 404);
  assert.deepEqual(
    (await req("/field/technicians")).items.map((t) => t.id),
    [a.id],
  );
});
