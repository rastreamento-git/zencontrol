const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const { reconcile } = require("../scripts/reconcile");
const { createApp } = require("../src/app");
let database, pool, server, base;
const env = {
  NODE_ENV: "production",
  CORS_ORIGINS: "https://invent.example",
  APP_PASSWORD: "test-inventory-password",
  SESSION_SECRET: "a".repeat(48),
};
let token;
async function request(
  route,
  body,
  method = "POST",
  authorization = token,
  headers = {},
) {
  const response = await fetch(base + "/api/" + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
const get = (route) => request(route, undefined, "GET");
async function product(name = "NT40", category = "RASTREADOR", min = 0) {
  const result = await request("produtos", {
    nome: name,
    categoria: category,
    estoque_minimo: min,
  });
  assert.equal(result.status, 201);
  return result.body.produto.id;
}
async function tech(name = "Ana") {
  const result = await request("tecnicos", { nome: name });
  assert.equal(result.status, 201);
  return result.body.tecnico.id;
}
async function enter(id, codes) {
  const r = await request("entrada", { produto_id: id, seriais: codes });
  assert.equal(r.status, 200);
  return r;
}
async function balances(id, expected, technicianId, techExpected) {
  const matrix = (await get("produtos")).body.find((p) => p.id === id);
  assert.equal(matrix.quantidade_matriz, expected);
  if (technicianId) {
    const entries = (await get("estoque-tecnicos")).body;
    const found = entries.find(
      (e) => e.produto_id === id && e.tecnico_id === technicianId,
    );
    assert.equal(found?.quantidade || 0, techExpected);
  }
}
before(async () => {
  database = await testDatabase();
  pool = database.pool;
  await migrate(pool);
  await migrate(pool);
  server = createApp(pool, env).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await request(
    "auth/login",
    { password: env.APP_PASSWORD },
    "POST",
    null,
  );
  assert.equal(login.status, 200);
  token = login.body.token;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (database) await database.close();
});
beforeEach(async () => {
  await pool.query(
    "TRUNCATE eventos_seriais,movimentacoes,equipamentos_seriais,estoque_tecnicos,tecnicos,produtos RESTART IDENTITY CASCADE",
  );
});
test("migration is repeatable, all read routes work and graph has seven zero days", async () => {
  assert.equal(
    (await pool.query("SELECT * FROM schema_migrations")).rows.length,
    3,
  );
  for (const route of [
    "produtos",
    "tecnicos",
    "estoque-tecnicos",
    "logs",
    "imeis",
    "previsao-compras",
  ]) {
    const r = await get(route);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
  }
  const dash = await get("dashboard");
  assert.equal(dash.status, 200);
  assert.equal(dash.body.grafico.length, 7);
  assert.ok(dash.body.grafico.every((d) => d.instalacoes === 0));
  assert.equal(dash.body.kpis.diario, 0);
});
test("protects reads and writes; rejects invalid password, altered and expired tokens", async () => {
  assert.equal((await request("produtos", undefined, "GET", null)).status, 401);
  assert.equal(
    (await request("entrada", { seriais: ["a"], produto_id: 1 }, "POST", null))
      .status,
    401,
  );
  assert.equal(
    (await request("auth/login", { password: "wrong" }, "POST", null)).status,
    401,
  );
  assert.equal(
    (await request("produtos", undefined, "GET", token + "x")).status,
    401,
  );
  const { createHmac } = require("node:crypto");
  const expired = Buffer.from(
    JSON.stringify({ exp: Date.now() - 1000 }),
  ).toString("base64url");
  const signature = createHmac("sha256", env.SESSION_SECRET)
    .update(expired)
    .digest("base64url");
  assert.equal(
    (await request("produtos", undefined, "GET", expired + "." + signature))
      .status,
    401,
  );
});
test("origin allowlist supports preflight but rejects unknown sites", async () => {
  assert.equal(
    (
      await request("produtos", undefined, "GET", token, {
        Origin: "https://attacker.example",
      })
    ).status,
    403,
  );
  const response = await fetch(base + "/api/produtos", {
    method: "OPTIONS",
    headers: {
      Origin: env.CORS_ORIGINS,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    env.CORS_ORIGINS,
  );
});
test("validates model, technician, zero threshold, body and duplicate registrations", async () => {
  for (const nome of ["", " ", "x".repeat(121), 7])
    assert.equal((await request("produtos", { nome })).status, 400);
  const id = await product();
  assert.equal((await get("produtos")).body[0].estoque_minimo, 0);
  assert.equal(
    (await request("produtos", { nome: "nt40", categoria: "RASTREADOR" }))
      .status,
    409,
  );
  await tech();
  assert.equal((await request("tecnicos", { nome: "ana" })).status, 409);
  assert.equal(
    (
      await request(
        "configurar-alerta",
        { tipo: "other", id, novo_limite: 4 },
        "PUT",
      )
    ).status,
    400,
  );
  for (const limit of [-1, 1.5, "", null])
    assert.equal(
      (
        await request(
          "configurar-alerta",
          { tipo: "PRODUTO", id, novo_limite: limit },
          "PUT",
        )
      ).status,
      400,
    );
  const malformed = await fetch(base + "/api/entrada", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await request("entrada", {}, "POST")).status, 400);
  assert.equal(
    (await request("entrada", { produto_id: 999, seriais: ["a"] })).status,
    404,
  );
});
test("entry rejects duplicated/blank/numeric serials without inflating stock; keeps leading zeros", async () => {
  const id = await product();
  await enter(id, ["0000123", "second"]);
  assert.equal(
    (await request("entrada", { produto_id: id, seriais: ["0000123", "new"] }))
      .status,
    409,
  );
  for (const codes of [
    [],
    ["a", " a "],
    [" "],
    [123],
    null,
    ["x".repeat(129)],
    Array.from({ length: 1001 }, (_, i) => String(i)),
  ])
    assert.equal(
      (await request("entrada", { produto_id: id, seriais: codes })).status,
      400,
    );
  await balances(id, 2);
  assert.equal((await get("imeis")).body.length, 2);
  assert.equal((await get("logs")).body.length, 1);
});
test("transfer and installation validate model/owner and commit the entire batch", async () => {
  const a = await product(),
    b = await product("TAG1", "TAG"),
    t = await tech(),
    other = await tech("Bruno");
  await enter(a, ["a1", "a2"]);
  await enter(b, ["b1"]);
  assert.equal(
    (
      await request("transferir", {
        produto_id: a,
        tecnico_id: t,
        seriais: ["a1", "b1"],
      })
    ).status,
    409,
  );
  await balances(a, 2);
  await balances(b, 1);
  assert.equal(
    (
      await request("transferir", {
        produto_id: a,
        tecnico_id: t,
        seriais: ["a1", "missing"],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("transferir", {
        produto_id: a,
        tecnico_id: t,
        seriais: ["a1", "a2"],
      })
    ).body.transferidos,
    2,
  );
  await balances(a, 0, t, 2);
  assert.equal(
    (
      await request("instalar", {
        produto_id: a,
        tecnico_id: other,
        seriais: ["a1"],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("instalar", {
        produto_id: b,
        tecnico_id: t,
        seriais: ["a1"],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("instalar", {
        produto_id: a,
        tecnico_id: t,
        seriais: ["a1"],
      })
    ).body.instalados,
    1,
  );
  await balances(a, 0, t, 1);
  assert.equal(
    (
      await request("instalar", {
        produto_id: a,
        tecnico_id: t,
        seriais: ["a1"],
      })
    ).status,
    409,
  );
  await balances(a, 0, t, 1);
  const serial = (await get("imeis")).body.find(
    (i) => i.codigo_serial === "a1",
  );
  assert.equal(serial.produto_id, a);
  assert.equal(serial.tecnico_id, t);
  const dashboard = (await get("dashboard")).body;
  assert.equal(dashboard.kpis.diario, 1);
  assert.equal(dashboard.tecnicos.find((i) => i.id === t).total_mes, 1);
});
test("technician return cannot return installed equipment or another product", async () => {
  const a = await product(),
    b = await product("Other"),
    t = await tech();
  await enter(a, ["a", "b"]);
  await request("transferir", {
    produto_id: a,
    tecnico_id: t,
    seriais: ["a", "b"],
  });
  await request("instalar", { produto_id: a, tecnico_id: t, seriais: ["a"] });
  assert.equal(
    (
      await request("estorno", {
        tipo_estorno: "TECNICO",
        produto_id: a,
        tecnico_id: t,
        seriais: ["a", "b"],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("estorno", {
        tipo_estorno: "TECNICO",
        produto_id: b,
        tecnico_id: t,
        seriais: ["b"],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("estorno", {
        tipo_estorno: "other",
        produto_id: a,
        seriais: ["b"],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("estorno", {
        tipo_estorno: "TECNICO",
        produto_id: a,
        tecnico_id: t,
        seriais: ["b"],
      })
    ).body.estornados,
    1,
  );
  await balances(a, 1, t, 0);
});
test("matrix correction checks model and keeps serial audit after deletion", async () => {
  const a = await product(),
    b = await product("Other");
  await enter(a, ["a"]);
  assert.equal(
    (
      await request("estorno", {
        tipo_estorno: "MATRIZ",
        produto_id: b,
        seriais: ["a"],
      })
    ).status,
    409,
  );
  await balances(a, 1);
  assert.equal(
    (
      await request("estorno", {
        tipo_estorno: "MATRIZ",
        produto_id: a,
        seriais: ["a"],
      })
    ).status,
    200,
  );
  await balances(a, 0);
  const events = (await get("imeis/a/historico")).body;
  assert.equal(events.length, 2);
  assert.equal(events[0].status_novo, "CANCELADO");
  assert.equal(
    (await request(`produtos/${a}`, undefined, "DELETE")).status,
    409,
  );
});
test("triage adjusts matrix and technician stock, records installed returns and refuses re-receipt", async () => {
  const a = await product(),
    b = await product("Tag", "TAG"),
    t = await tech();
  await enter(a, ["matrix", "tech", "installed"]);
  await enter(b, ["tag"]);
  await request("transferir", {
    produto_id: a,
    tecnico_id: t,
    seriais: ["tech", "installed"],
  });
  await request("instalar", {
    produto_id: a,
    tecnico_id: t,
    seriais: ["installed"],
  });
  assert.equal(
    (
      await request("triagem/receber", {
        seriais: ["matrix", "tech", "installed", "tag"],
      })
    ).body.recebidos,
    4,
  );
  await balances(a, 0, t, 0);
  await balances(b, 0);
  assert.equal(
    (await request("triagem/receber", { seriais: ["matrix"] })).status,
    409,
  );
  assert.equal(
    (await get("imeis")).body.filter((i) => i.status === "TRIAGEM").length,
    4,
  );
});
test("triage evaluation uses actual product and is safe on repeated approval/rejection", async () => {
  const a = await product(),
    b = await product("Tag", "TAG");
  await enter(a, ["a", "b"]);
  assert.equal(
    (await request("triagem/avaliar", { codigo_serial: "a", aprovado: true }))
      .status,
    409,
  );
  await request("triagem/receber", { seriais: ["a", "b"] });
  assert.equal(
    (
      await request("triagem/avaliar", {
        codigo_serial: "a",
        produto_id: b,
        aprovado: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("triagem/avaliar", {
        codigo_serial: "a",
        aprovado: "false",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("triagem/avaliar", { codigo_serial: "a", aprovado: true }))
      .status,
    200,
  );
  await balances(a, 1);
  assert.equal(
    (await request("triagem/avaliar", { codigo_serial: "a", aprovado: true }))
      .status,
    409,
  );
  await balances(a, 1);
  assert.equal(
    (await request("triagem/avaliar", { codigo_serial: "b", aprovado: false }))
      .status,
    200,
  );
  await balances(a, 1);
  assert.equal(
    (await request("triagem/avaliar", { codigo_serial: "b", aprovado: true }))
      .status,
    409,
  );
  await balances(a, 1);
});
test("invalid mixed triage batch rolls back and simulated audit failure rolls back changes", async () => {
  const a = await product();
  await enter(a, ["a", "b"]);
  await request("triagem/receber", { seriais: ["a"] });
  await request("triagem/avaliar", { codigo_serial: "a", aprovado: false });
  assert.equal(
    (await request("triagem/receber", { seriais: ["b", "a"] })).status,
    409,
  );
  await balances(a, 1);
  await pool.query(
    "CREATE FUNCTION fail_audit_test() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END; $$ LANGUAGE plpgsql",
  );
  await pool.query(
    "CREATE TRIGGER fail_audit BEFORE INSERT ON eventos_seriais FOR EACH ROW EXECUTE FUNCTION fail_audit_test()",
  );
  try {
    assert.equal(
      (await request("entrada", { produto_id: a, seriais: ["new"] })).status,
      500,
    );
    await balances(a, 1);
    assert.equal(
      (await get("imeis")).body.some((i) => i.codigo_serial === "new"),
      false,
    );
  } finally {
    await pool.query("DROP TRIGGER fail_audit ON eventos_seriais");
    await pool.query("DROP FUNCTION fail_audit_test()");
  }
});
test("concurrent requests cannot transfer the same serial twice or double-count entry", async () => {
  const id = await product(),
    a = await tech(),
    b = await tech("Bruno");
  const entries = await Promise.all([
    request("entrada", { produto_id: id, seriais: ["a"] }),
    request("entrada", { produto_id: id, seriais: ["a"] }),
  ]);
  assert.deepEqual(entries.map((r) => r.status).sort(), [200, 409]);
  await balances(id, 1);
  const transfers = await Promise.all([
    request("transferir", { produto_id: id, tecnico_id: a, seriais: ["a"] }),
    request("transferir", { produto_id: id, tecnico_id: b, seriais: ["a"] }),
  ]);
  assert.deepEqual(transfers.map((r) => r.status).sort(), [200, 409]);
  await balances(id, 0);
  assert.equal(
    (await get("estoque-tecnicos")).body.reduce(
      (sum, r) => sum + r.quantidade,
      0,
    ),
    1,
  );
});
test("archives old installed serials without deleting identity and can triage archived returns", async () => {
  const id = await product(),
    t = await tech();
  await enter(id, ["old", "recent"]);
  await request("transferir", {
    produto_id: id,
    tecnico_id: t,
    seriais: ["old", "recent"],
  });
  await request("instalar", {
    produto_id: id,
    tecnico_id: t,
    seriais: ["old", "recent"],
  });
  await pool.query(
    "UPDATE equipamentos_seriais SET data_atualizacao=CURRENT_TIMESTAMP-INTERVAL '31 days' WHERE codigo_serial='old'",
  );
  const result = await request("limpeza-instalados", undefined, "DELETE");
  assert.equal(result.body.arquivados, 1);
  assert.equal(result.body.apagados, 0);
  assert.equal((await get("imeis")).body.length, 1);
  assert.equal((await get("imeis?incluir_arquivados=true")).body.length, 2);
  assert.equal(
    (await request("entrada", { produto_id: id, seriais: ["old"] })).status,
    409,
  );
  assert.equal(
    (await request("triagem/receber", { seriais: ["old"] })).status,
    200,
  );
  assert.equal((await get("imeis")).body.length, 2);
  const history = (await get("imeis/old/historico")).body;
  assert.equal(history.length, 5);
});
test("deletion checks actual serial holdings and retains technician history", async () => {
  const id = await product(),
    t = await tech(),
    empty = await product("Empty");
  await enter(id, ["a"]);
  await request("transferir", {
    produto_id: id,
    tecnico_id: t,
    seriais: ["a"],
  });
  await pool.query("UPDATE estoque_tecnicos SET quantidade=0");
  assert.equal(
    (await request(`tecnicos/${t}`, undefined, "DELETE")).status,
    409,
  );
  assert.equal(
    (await request(`produtos/${id}`, undefined, "DELETE")).status,
    409,
  );
  assert.equal(
    (await request(`produtos/${empty}`, undefined, "DELETE")).status,
    200,
  );
  await request("estorno", {
    tipo_estorno: "TECNICO",
    produto_id: id,
    tecnico_id: t,
    seriais: ["a"],
  });
  assert.equal(
    (await request(`tecnicos/${t}`, undefined, "DELETE")).status,
    200,
  );
  assert.equal((await get("tecnicos")).body.length, 0);
  assert.equal(
    (
      await request("transferir", {
        produto_id: id,
        tecnico_id: t,
        seriais: ["a"],
      })
    ).status,
    404,
  );
});
test("category alert update is atomic and purchase suggestions are whole units", async () => {
  const a = await product(),
    b = await product("NT50");
  assert.equal(
    (
      await request(
        "configurar-alerta",
        { tipo: "CATEGORIA", id: "RASTREADOR", novo_limite: 17 },
        "PUT",
      )
    ).status,
    200,
  );
  assert.ok((await get("produtos")).body.every((p) => p.estoque_minimo === 17));
  await pool.query(
    "INSERT INTO movimentacoes (tipo,produto_id,quantidade) VALUES ('USO_FINAL',$1,1)",
    [a],
  );
  const forecast = (await get("previsao-compras")).body;
  assert.ok(forecast.every((p) => Number.isInteger(p.sugerido)));
  assert.equal(forecast.find((p) => p.id === b).sugerido, 17);
});
test("reconciliation reports differences and only applies when requested", async () => {
  const id = await product(),
    t = await tech();
  await enter(id, ["a", "b"]);
  await request("transferir", {
    produto_id: id,
    tecnico_id: t,
    seriais: ["b"],
  });
  await pool.query("UPDATE produtos SET quantidade_matriz=99 WHERE id=$1", [
    id,
  ]);
  await pool.query("UPDATE estoque_tecnicos SET quantidade=55");
  const report = await reconcile(pool);
  assert.equal(report.matriz[0].esperado, 1);
  assert.equal(report.tecnicos[0].esperado, 1);
  await balances(id, 99, t, 55);
  await reconcile(pool, true);
  await balances(id, 1, t, 1);
});
test("operational health and safe errors without exposing database details", async () => {
  const response = await fetch(base + "/healthz");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  assert.equal((await get("missing")).status, 404);
  assert.equal(
    (await request("produtos/nope", undefined, "DELETE")).status,
    400,
  );
});
