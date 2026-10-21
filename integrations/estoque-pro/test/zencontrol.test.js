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
  const history = await request("/technicians/" + tid + "/history?page=1");
  assert.equal(history.status, 200);
  assert.equal(history.data.limit, 50);
  assert.ok(history.data.items.some((e) => e.codigo_serial === "zero-001"));
  assert.ok(history.data.items.every((e) => e.codigo_serial !== "zero-003"));
  assert.equal(
    (
      await request(
        "/technicians/" + tid + "/history?page=1",
        null,
        null,
        "wrong-secret",
      )
    ).status,
    401,
  );
  assert.equal(
    (await request("/technicians/" + tid + "/history?page=0")).status,
    400,
  );
  assert.equal(load.data.items[0].status, "TECNICO");
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

test("reused serial keeps each historical installation linked to its own OS without duplicate history rows", async () => {
  const { receive, evaluate } = require("../src/inventory");
  const code = "zero-002",
    payload = {
      source_system: "history-test",
      order_id: "OS-HISTORY-ONE",
      submission_id: "submission-history-one",
      technician_id: tid,
      serials: [code],
      operator: "Teste histórico",
    };
  assert.equal(
    (await request("/installations", payload, "history:installation:one"))
      .status,
    200,
  );
  await receive(pool, { seriais: [code] });
  await evaluate(pool, { codigo_serial: code, aprovado: true });
  await move(pool, "transferir", {
    produto_id: pid,
    tecnico_id: tid,
    seriais: [code],
  });
  assert.equal(
    (
      await request(
        "/installations",
        {
          ...payload,
          order_id: "OS-HISTORY-TWO",
          submission_id: "submission-history-two",
        },
        "history:installation:two",
      )
    ).status,
    200,
  );
  const events = (
    await request("/technicians/" + tid + "/history")
  ).data.items.filter(
    (e) => e.codigo_serial === code && e.status_novo === "INSTALADO",
  );
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.order_id).sort(), [
    "OS-HISTORY-ONE",
    "OS-HISTORY-TWO",
  ]);
});

test("reused devices require installed inventory, preserve load quantities and record an idempotent reinstallation event", async () => {
  const code = "reuse-contract-001";
  await move(pool, "entrada", { produto_id: pid, seriais: [code] });
  await move(pool, "transferir", {
    produto_id: pid,
    tecnico_id: tid,
    seriais: [code],
  });
  const payload = {
    source_system: "zencontrol",
    order_id: "REUSE-ORIGINAL",
    submission_id: "REUSE-ORIGINAL-SUB",
    technician_id: tid,
    serials: [code],
    operator: "Operador original",
  };
  assert.equal(
    (await request("/installations", payload, "reuse-original-key-1234"))
      .status,
    200,
  );
  assert.equal(
    (await request("/reusable-items", { serials: [code] }, null, "invalid"))
      .status,
    401,
  );
  const available = await request("/reusable-items", {
    serials: [code, "zero-003"],
  });
  assert.equal(available.status, 200);
  assert.deepEqual(
    available.data.items.map((item) => item.codigo_serial),
    [code],
  );
  const balances = (
    await pool.query("SELECT * FROM estoque_tecnicos ORDER BY id")
  ).rows;
  const moves = (await pool.query("SELECT count(*)::int n FROM movimentacoes"))
    .rows[0].n;
  const reuse = {
    ...payload,
    order_id: "REUSE-SECOND",
    submission_id: "REUSE-SECOND-SUB",
    technician_id: other,
    operator: "Outro operador",
    reuse: true,
  };
  const results = await Promise.all([
    request("/installations", reuse, "reuse-second-key-1234"),
    request("/installations", reuse, "reuse-second-key-1234"),
  ]);
  assert.ok(
    results.every(
      (result) => result.status === 200 && result.data.reused === true,
    ),
  );
  assert.equal(results[0].data.receipt_id, results[1].data.receipt_id);
  assert.deepEqual(
    (await pool.query("SELECT * FROM estoque_tecnicos ORDER BY id")).rows,
    balances,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM movimentacoes")).rows[0].n,
    moves,
  );
  const events = (
    await pool.query(
      "SELECT * FROM eventos_seriais WHERE zen_order_id='REUSE-SECOND'",
    )
  ).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].status_anterior, "INSTALADO");
  assert.equal(events[0].status_novo, "INSTALADO");
  assert.equal(events[0].tecnico_id, other);
  assert.equal(events[0].movimentacao_id, null);
  const history = await request("/technicians/" + other + "/history");
  assert.ok(
    history.data.items.some(
      (item) =>
        item.order_id === "REUSE-SECOND" && item.tipo === "REINSTALACAO",
    ),
  );
  const invalid = await request(
    "/installations",
    {
      ...reuse,
      order_id: "REUSE-INVALID",
      submission_id: "REUSE-INVALID-SUB",
      serials: ["zero-003"],
    },
    "reuse-invalid-key-1234",
  );
  assert.equal(invalid.status, 409);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM zencontrol_installations WHERE order_id='REUSE-INVALID'",
      )
    ).rows[0].n,
    0,
  );
});
