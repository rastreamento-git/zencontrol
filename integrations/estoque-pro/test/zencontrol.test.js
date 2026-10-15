const { test, before, after } = require("node:test");
const assert = require("node:assert/strict"),
  { once } = require("node:events");
const { testDatabase } = require("./helpers/database.cjs"),
  { migrate } = require("../scripts/migrate");
const { createApp } = require("../src/app"),
  { move } = require("../src/inventory");
let db, pool, server, base, tid, other, pid;
const secret = "test-only-zencontrol-integration-1234567890";
async function request(route, body, key, token = secret) {
  const r = await fetch(base + "/api/integrations/zencontrol" + route, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
before(async () => {
  db = await testDatabase();
  pool = db.pool;
  await migrate(pool);
  server = createApp(pool, {
    NODE_ENV: "test",
    SESSION_SECRET: secret,
    APP_PASSWORD: "test-only-password-123456",
    ZENCONTROL_INTEGRATION_SECRET: secret,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
  tid = (
    await pool.query(
      "INSERT INTO tecnicos(nome) VALUES('Técnico teste') RETURNING id",
    )
  ).rows[0].id;
  other = (
    await pool.query(
      "INSERT INTO tecnicos(nome) VALUES('Outro técnico') RETURNING id",
    )
  ).rows[0].id;
  pid = (
    await pool.query(
      "INSERT INTO produtos(nome,categoria) VALUES('Modelo teste','RASTREADOR') RETURNING id",
    )
  ).rows[0].id;
  await move(pool, "entrada", {
    produto_id: pid,
    seriais: ["zero-001", "zero-002", "zero-003"],
  });
  await move(pool, "transferir", {
    produto_id: pid,
    tecnico_id: tid,
    seriais: ["zero-001", "zero-002"],
  });
  await move(pool, "transferir", {
    produto_id: pid,
    tecnico_id: other,
    seriais: ["zero-003"],
  });
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
});
test("adapter authenticates its own secret and limits available inventory by technician", async () => {
  assert.equal((await request("/catalog", null, null, "invalid")).status, 401);
  const catalog = await request("/catalog");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.data.technicians.length, 2);
  const load = await request("/technicians/" + tid + "/items");
  assert.deepEqual(
    load.data.items.map((e) => e.codigo_serial),
    ["zero-001", "zero-002"],
  );
  const isolated = createApp(pool, {
    NODE_ENV: "test",
    APP_PASSWORD: "test-only-password-123456",
    SESSION_SECRET: secret,
  }).listen(0, "127.0.0.1");
  await once(isolated, "listening");
  try {
    const r = await fetch(
      "http://127.0.0.1:" +
        isolated.address().port +
        "/api/integrations/zencontrol/catalog",
      { headers: { Authorization: "Bearer " + secret } },
    );
    assert.equal(r.status, 503);
  } finally {
    await new Promise((r) => isolated.close(r));
  }
});
test("atomic installation, business refusal and concurrent retries preserve one movement and receipt", async () => {
  const payload = {
      source_system: "zc-test",
      order_id: "OS-TEST-001",
      submission_id: "submission-test-001",
      technician_id: tid,
      serials: ["zero-001", "zero-003"],
      operator: "Central de teste",
    },
    key = "stock:test:submission-test-001";
  const wrong = await request("/installations", payload, key);
  assert.equal(wrong.status, 409);
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM equipamentos_seriais WHERE codigo_serial='zero-001'",
      )
    ).rows[0].status,
    "TECNICO",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer n FROM zencontrol_installations",
      )
    ).rows[0].n,
    0,
  );
  payload.serials = ["zero-001"];
  const both = await Promise.all([
    request("/installations", payload, key),
    request("/installations", payload, key),
  ]);
  assert.ok(
    both.every((r) => r.status === 200),
    JSON.stringify(both),
  );
  assert.equal(both[0].data.receipt_id, both[1].data.receipt_id);
  assert.equal(
    (
      await request(
        "/installations",
        { ...payload, serials: ["zero-002"] },
        key,
      )
    ).status,
    409,
  );
  assert.equal(
    (await request("/installations", payload, key + "-other")).status,
    409,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer n FROM movimentacoes WHERE tipo='USO_FINAL'",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer n FROM zencontrol_installations",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT quantidade FROM estoque_tecnicos WHERE tecnico_id=$1 AND produto_id=$2",
        [tid, pid],
      )
    ).rows[0].quantidade,
    1,
  );
});
