const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events");
const { testDatabase } = require("./helpers/database.cjs"),
  { migrate } = require("../scripts/migrate"),
  { createApp } = require("../src/app"),
  { move } = require("../src/inventory");
let db, server, base, token, tid, other, pid;
const password = "test-only-adhesive-password-123",
  secret = "test-only-adhesive-integration-secret-123456789";
async function call(path, body, key, integration = false) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + (integration ? secret : token),
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
before(async () => {
  db = await testDatabase();
  await migrate(db.pool);
  const app = createApp(db.pool, {
    NODE_ENV: "test",
    APP_PASSWORD: password,
    SESSION_SECRET: secret,
    ZENCONTROL_INTEGRATION_SECRET: secret,
  });
  await app.locals.ready();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
  token = (await call("/api/auth/login", { login: "admin", password })).data
    .token;
  tid = (
    await db.pool.query(
      "INSERT INTO tecnicos(nome) VALUES('Técnico A') RETURNING id",
    )
  ).rows[0].id;
  other = (
    await db.pool.query(
      "INSERT INTO tecnicos(nome) VALUES('Técnico B') RETURNING id",
    )
  ).rows[0].id;
  pid = (
    await db.pool.query(
      "INSERT INTO produtos(nome,categoria) VALUES('Rastreador teste','RASTREADOR') RETURNING id",
    )
  ).rows[0].id;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
});
test("adesivo tem saldo por quantidade, carga de técnico, devolução e idempotência", async () => {
  assert.equal((await call("/api/adesivos")).data.matrix, 0);
  const input = { type: "ENTRADA", quantity: 10 };
  assert.equal(
    (await call("/api/adesivos/movements", input, "manual-entrada-001")).status,
    200,
  );
  assert.equal(
    (await call("/api/adesivos/movements", input, "manual-entrada-001")).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/api/adesivos/movements",
        { ...input, quantity: 11 },
        "manual-entrada-001",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        "/api/adesivos/movements",
        { type: "TRANSFERENCIA", quantity: 3, technician_id: tid },
        "manual-transfer-001",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/api/adesivos/movements",
        { type: "DEVOLUCAO", quantity: 1, technician_id: tid },
        "manual-devolver-001",
      )
    ).status,
    200,
  );
  const state = (await call("/api/adesivos")).data;
  assert.equal(state.matrix, 8);
  assert.equal(state.technicians.find((t) => t.id === tid).quantidade, 2);
  assert.equal(
    (
      await call(
        "/api/adesivos/movements",
        { type: "APLICACAO", quantity: 1, technician_id: tid },
        "manual-aplicar-001",
      )
    ).status,
    400,
  );
});
test("aplicação 2371 é vinculada à OS e técnico, sem exigir serial nem baixar novamente ao repetir", async () => {
  const body = {
    source_system: "zencontrol",
    order_id: "20261113001",
    submission_id: "submission-sticker-001",
    technician_id: tid,
    serials: [],
    consumables: [{ sga_product_code: "2371", quantity: 1 }],
    operator: "Operador teste",
  };
  const path = "/api/integrations/zencontrol/installations",
    key = "adesivo-install-0001";
  const first = await call(path, body, key, true);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const again = await call(path, body, key, true);
  assert.deepEqual(again.data, first.data);
  assert.deepEqual(first.data.consumables, body.consumables);
  assert.equal(
    (await call("/api/adesivos")).data.technicians.find((t) => t.id === tid)
      .quantidade,
    1,
  );
  const movement = (
    await db.pool.query(
      "SELECT * FROM adesivo_movimentos WHERE tipo='APLICACAO'",
    )
  ).rows;
  assert.equal(movement.length, 1);
  assert.equal(movement[0].order_id, body.order_id);
  assert.equal(movement[0].tecnico_id, tid);
});
test("falta de adesivo desfaz também a instalação do rastreador; reposição permite repetir com segurança", async () => {
  await move(db.pool, "entrada", {
    produto_id: pid,
    seriais: ["TESTE-ADESIVO-001"],
  });
  await move(db.pool, "transferir", {
    produto_id: pid,
    tecnico_id: other,
    seriais: ["TESTE-ADESIVO-001"],
  });
  const body = {
    source_system: "zencontrol",
    order_id: "20261113002",
    submission_id: "submission-sticker-002",
    technician_id: other,
    serials: ["TESTE-ADESIVO-001"],
    consumables: [{ sga_product_code: "2371", quantity: 1 }],
    operator: "Operador teste",
  };
  const path = "/api/integrations/zencontrol/installations",
    key = "adesivo-install-0002";
  const failed = await call(path, body, key, true);
  assert.equal(failed.status, 409, JSON.stringify(failed.data));
  assert.equal(
    (
      await db.pool.query(
        "SELECT status FROM equipamentos_seriais WHERE codigo_serial='TESTE-ADESIVO-001'",
      )
    ).rows[0].status,
    "TECNICO",
  );
  assert.equal(
    (
      await db.pool.query(
        "SELECT * FROM zencontrol_installations WHERE order_id=$1",
        [body.order_id],
      )
    ).rows.length,
    0,
  );
  await call(
    "/api/adesivos/movements",
    { type: "TRANSFERENCIA", quantity: 1, technician_id: other },
    "manual-transfer-002",
  );
  const retried = await call(path, body, key, true);
  assert.equal(retried.status, 200, JSON.stringify(retried.data));
  assert.equal(
    (
      await db.pool.query(
        "SELECT status FROM equipamentos_seriais WHERE codigo_serial='TESTE-ADESIVO-001'",
      )
    ).rows[0].status,
    "INSTALADO",
  );
  assert.equal(
    (await call("/api/adesivos")).data.technicians.find((t) => t.id === other)
      .quantidade,
    0,
  );
});
