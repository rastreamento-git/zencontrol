const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { randomBytes, createHash } = require("node:crypto");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { testDatabase } = require("./helpers/database.cjs"),
  { migrate } = require("../scripts/migrate");
const {
  migrate: stockMigrate,
} = require("../../../integrations/estoque-pro/scripts/migrate");
const { createApp } = require("../src/app"),
  {
    createApp: stockApp,
  } = require("../../../integrations/estoque-pro/src/app");
const { hashPassword } = require("../src/auth");
const intake = require("../src/sga-intake");
const { today } = require("../src/domain");
const password = "Unified1!teste",
  secret = "test-only-stock-integration-secret-123456789";
let db,
  sdb,
  server,
  stock,
  base,
  sbase,
  folder,
  admin,
  operator,
  technical,
  oid,
  tid;
async function req(url, route, body, token) {
  const r = await fetch(url + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
async function login(name) {
  const r = await req(base, "/api/auth/login", {
    login: name,
    password,
    audience: "ecosystem",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token;
}
async function code(token, app) {
  const verifier = randomBytes(32).toString("base64url"),
    state = randomBytes(24).toString("base64url"),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const r = await req(
    base,
    "/api/auth/sso/code",
    { app, state, challenge },
    token,
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return {
    app,
    state,
    verifier,
    code: new URLSearchParams(new URL(r.data.redirect_url).hash.slice(1)).get(
      "zen_code",
    ),
  };
}
async function grant(token) {
  const r = await req(
    sbase,
    "/api/auth/sso/exchange",
    await code(token, "stock"),
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
before(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "zen-sso-test-"));
  db = await testDatabase();
  sdb = await testDatabase();
  await migrate(db.pool);
  await stockMigrate(sdb.pool);
  const central = createApp(db.pool, {
    APP_PASSWORD: password,
    SESSION_SECRET: "central-test-secret-1234567890123456789",
    ZEN_WEBHOOK_SECRET: secret,
    STOCK_API_SECRET: secret,
    SSO_LOGIN_URL: "http://127.0.0.1:4320",
    SSO_STOCK_URL: "http://127.0.0.1:4321",
    TECHNICIAN_PORTAL_URL: "http://127.0.0.1:4319",
    ZEN_DATA_DIR: folder,
    SGA_READ_ENABLED: "true",
    HINOVA_TOKEN_ASSOC: "test-only",
    HINOVA_USER: "test-only",
    HINOVA_PASS: "test-only",
  });
  await central.locals.ready();
  server = central.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
  const inventory = stockApp(sdb.pool, {
    APP_PASSWORD: password,
    SESSION_SECRET: "stock-test-secret-12345678901234567890",
    ZEN_IDENTITY_API_URL: base,
    ZENCONTROL_INTEGRATION_SECRET: secret,
    ZEN_LOGIN_URL: "http://127.0.0.1:4320",
  });
  await inventory.locals.ready();
  stock = inventory.listen(0, "127.0.0.1");
  await once(stock, "listening");
  sbase = "http://127.0.0.1:" + stock.address().port;
  const hash = await hashPassword(password);
  oid = (
    await db.pool.query(
      "INSERT INTO usuarios(login,nome,senha_hash,papel) VALUES('operador','Operador fictício',$1,'operador') RETURNING id",
      [hash],
    )
  ).rows[0].id;
  tid = (
    await db.pool.query(
      "INSERT INTO usuarios(login,nome,senha_hash,papel) VALUES('tecnico','Técnico fictício',$1,'tecnico') RETURNING id",
      [hash],
    )
  ).rows[0].id;
  const t = (
    await db.pool.query(
      "INSERT INTO zc_technicians(name) VALUES('Técnico fictício') RETURNING id",
    )
  ).rows[0];
  await db.pool.query(
    "INSERT INTO zc_technician_accounts(user_id,technician_id) VALUES($1,$2)",
    [tid, t.id],
  );
  admin = await login("admin");
  operator = await login("operador");
  technical = await login("tecnico");
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (stock) await new Promise((r) => stock.close(r));
  await db?.close();
  await sdb?.close();
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});
test("master entry exposes exact origins and no secrets", async () => {
  const r = await req(base, "/api/auth/config");
  assert.equal(r.data.unified_login, true);
  assert.equal(r.data.apps.stock, "http://127.0.0.1:4321");
  assert.ok(!JSON.stringify(r.data).includes(secret));
});
test("admin and operator use central identity in stock without colliding with its native admin", async () => {
  for (const token of [admin, operator]) {
    const g = await grant(token);
    const field = await req(
      base,
      "/api/auth/sso/exchange",
      await code(token, "zenfield"),
    );
    assert.equal(field.status, 200);
    assert.equal(field.data.user.papel, g.user.papel);
    assert.equal(
      (await req(base, "/api/field/technicians", undefined, field.data.token))
        .status,
      200,
    );
    assert.equal(
      (await req(base, "/api/technician/me", undefined, field.data.token))
        .status,
      400,
    );
    assert.match(g.token, /^zen_sso_/);
    assert.notEqual(g.user.id, 1);
    const session = await req(sbase, "/api/auth/session", undefined, g.token);
    assert.equal(session.data.authenticated, true);
    assert.equal(session.data.user.identity_provider, "zen");
    assert.equal(
      (await req(sbase, "/api/produtos", undefined, g.token)).status,
      200,
    );
    assert.equal(
      (await req(sbase, "/api/admin/users", undefined, g.token)).status,
      409,
    );
  }
  assert.equal(
    (
      await sdb.pool.query(
        "SELECT count(*)::int n FROM usuarios WHERE zen_identity_id IS NOT NULL",
      )
    ).rows[0].n,
    2,
  );
});
test("technician receives a field session but never central or stock access", async () => {
  for (const app of ["stock", "zencontrol"])
    assert.equal(
      (
        await req(
          base,
          "/api/auth/sso/code",
          { app, state: "x".repeat(32), challenge: "x".repeat(43) },
          technical,
        )
      ).status,
      403,
    );
  const r = await req(
    base,
    "/api/auth/sso/exchange",
    await code(technical, "zenfield"),
  );
  assert.equal(r.status, 200);
  assert.equal(r.data.user.papel, "tecnico");
  assert.equal(
    (await req(base, "/api/overview", undefined, r.data.token)).status,
    403,
  );
  assert.equal(
    (await req(sbase, "/api/produtos", undefined, r.data.token)).status,
    401,
  );
});
test("code is single-use and bound to browser proof, state, destination and stock server", async () => {
  const p = await code(admin, "stock");
  for (const wrong of [
    { ...p, verifier: "x".repeat(43) },
    { ...p, state: "x".repeat(32) },
  ])
    assert.equal(
      (await req(sbase, "/api/auth/sso/exchange", wrong)).status,
      401,
    );
  assert.equal(
    (await req(base, "/api/auth/sso/exchange", { ...p, app: "zenfield" }))
      .status,
    401,
  );
  assert.equal((await req(base, "/api/auth/sso/exchange", p)).status, 401);
  assert.equal((await req(sbase, "/api/auth/sso/exchange", p)).status, 200);
  assert.equal((await req(sbase, "/api/auth/sso/exchange", p)).status, 401);
});
test("expired codes fail closed", async () => {
  const p = await code(admin, "stock");
  await db.pool.query(
    "UPDATE zc_sso_codes SET expires_at=now()-interval '1 second'",
  );
  assert.equal((await req(sbase, "/api/auth/sso/exchange", p)).status, 401);
});
test("sensitive inventory actions reauthenticate with the central password and native login is disabled", async () => {
  for (const token of [admin, operator]) {
    const g = await grant(token),
      identity =
        require("../../../integrations/estoque-pro/src/identity").identity(
          { ZEN_IDENTITY_API_URL: base, ZENCONTROL_INTEGRATION_SECRET: secret },
          sdb.pool,
          (r) => r,
        );
    await identity.reauthenticate({
      headers: { authorization: "Bearer " + g.token },
      body: { password },
    });
    await assert.rejects(
      () =>
        identity.reauthenticate({
          headers: { authorization: "Bearer " + g.token },
          body: { password: "wrong" },
        }),
      (e) => e.status === 403,
    );
  }
  assert.equal(
    (await req(sbase, "/api/auth/login", { login: "admin", password })).status,
    409,
  );
});
test("deactivation and role changes revoke stock access immediately", async () => {
  const g = await grant(operator);
  await db.pool.query("UPDATE usuarios SET ativo=false WHERE id=$1", [oid]);
  assert.equal(
    (await req(sbase, "/api/produtos", undefined, g.token)).status,
    401,
  );
  await db.pool.query(
    "UPDATE usuarios SET ativo=true,papel='tecnico' WHERE id=$1",
    [oid],
  );
  assert.equal(
    (await req(sbase, "/api/produtos", undefined, g.token)).status,
    401,
  );
  await db.pool.query("UPDATE usuarios SET papel='operador' WHERE id=$1", [
    oid,
  ]);
});
test("logout from stock revokes central session and all other grants", async () => {
  const a = await grant(admin),
    b = await grant(admin);
  assert.equal((await req(sbase, "/api/auth/logout", {}, a.token)).status, 200);
  assert.equal(
    (await req(base, "/api/auth/session", undefined, admin)).data.authenticated,
    false,
  );
  assert.equal(
    (await req(sbase, "/api/auth/session", undefined, b.token)).data
      .authenticated,
    false,
  );
});
test("expired inventory sessions can leave the local app", async () => {
  assert.equal(
    (
      await req(
        sbase,
        "/api/auth/logout",
        {},
        "zen_sso_" + randomBytes(32).toString("base64url"),
      )
    ).status,
    200,
  );
});

test("stock planning lists pending installation demand through a stock session", async () => {
  const entry = "72c57256-7ef9-4170-a557-8c895fa36dce";
  await db.pool.query(
    "INSERT INTO zc_sga_intake_runs(id,run_key,day,state,config,actor,created_at) VALUES('planning-test','planning-test','2026-11-23','completed','{}','fictício','2026-11-23')",
  );
  const data = {
    sga_id: "999999", vehicle: "FIC9A99", sga_classification: "Instalação Pendente",
    customer_name: "Pessoa fictícia", fipe_value: "65000",
    document_data: { vehicle_type: "Automóvel", fipe_region: "SP", fipe_override: "Alta" },
    coverage_choices: { electric: "no" }, sticker_discount_opt_in: false,
  };
  await db.pool.query(
    "INSERT INTO zc_sga_intake(id,sga_vehicle_id,customer_key,vehicle_key,customer_name,vehicle,movement_at,received_at,run_id,data,raw_source) VALUES($1,'999999','planning-customer','planning-car','Pessoa fictícia','FIC9A99','2026-11-23','2026-11-23','planning-test',$2,'{}')",
    [entry, JSON.stringify(data)],
  );
  const route = "/api/compras/instalacoes-pendentes";
  assert.equal((await req(sbase, route, undefined, technical)).status, 401);
  const { token } = await grant(await login("operador"));
  const response = await req(sbase, route, undefined, token);
  assert.equal(response.status, 200);
  const item = response.data.items.find((row) => row.id === entry);
  assert.equal(item.classification, "Instalação Pendente");
  assert.deepEqual(item.required, { RASTREADOR: 1, TAG: 1, PERFURADO: 0 });
  assert.ok(!JSON.stringify(response.data).includes(data.customer_name));
  const simulation = await req(sbase, route + "/cobertura", { ids: [entry] }, token);
  assert.equal(simulation.status, 200);
  assert.equal(simulation.data.items[0].state, "route_pending");
});

test("stock collection scans the requested period and verifies existing entries again", async () => {
  const route = "/api/compras/instalacoes-pendentes";
  const end = today();
  const start = new Date(Date.parse(end) - 86400000).toISOString().slice(0, 10);
  const payload = { start, end, confirmed: true };
  const { token: adminToken } = await grant(await login("admin"));
  const { token: operatorToken } = await grant(await login("operador"));
  const collect = (body, token = adminToken) => req(sbase, route + "/coletas", body, token);
  assert.equal((await collect(payload, technical)).status, 401);
  assert.equal((await collect(payload, operatorToken)).status, 403);
  assert.equal((await collect({ ...payload, confirmed: false })).status, 400);
  assert.equal((await collect({ ...payload, start: "2020-01-01" })).status, 400);
  assert.equal((await collect({ ...payload, end: "9999-01-01" })).status, 400);
  const days = [];
  let stillPending = true;
  const client = {
    ready: () => true,
    catalogs: async () => ({
      items: { classifications: [{ code: "42", label: "INSTALAÇÃO PENDENTE", active: true }] },
    }),
    pendingMovements: async (day, kind, code) => {
      days.push([day, kind, code]);
      return [day === end ? "999999" : "999998"].map((id) => ({
        codigo_veiculo: id,
        nome_campo_tabela: "codigo_classificacao",
        valor_anterior: "41",
        valor_posterior: "42",
        data_alteracao: day + "T10:00:00-0300",
      }));
    },
    lookup: async ({ sga_id }) => ({
      sga_id,
      customer_name: "Segundo associado fictício",
      vehicle: "FIC9A98",
      sga_source: { classification_code: stillPending ? "42" : "43" },
    }),
  };
  await intake.saveConfiguration(db.pool, client, {
    ...await intake.configuration(db.pool),
    pending_kind: "classifications",
    pending_code: "42",
    enabled: false,
  }, "Administrador fictício");
  const queued = await Promise.all([
    collect({ ...payload, pending_code: "43" }),
    collect(payload),
  ]);
  assert.equal(queued[0].status, 202);
  assert.equal(queued[1].data.id, queued[0].data.id);
  const get = (suffix) => req(sbase, route + suffix, undefined, operatorToken);
  const id = queued[0].data.id;
  assert.equal((await get("/coletas/" + id)).data.state, "queued");
  assert.equal((await get("?coleta=" + id)).status, 409);
  assert.equal(await intake.runCycle(db.pool, {}, { client }), true);
  assert.deepEqual(days, [[start, "classifications", "42"], [end, "classifications", "42"]]);
  const lookup = await get(`/coletas?start=${start}&end=${end}`);
  assert.equal(lookup.data.state, "completed");
  assert.equal(lookup.data.id, id);
  assert.equal(lookup.data.checked_days, 2);
  assert.ok(!("config" in lookup.data));
  const list = await get("?coleta=" + id);
  assert.equal(list.data.total, 2);
  assert.deepEqual(list.data.items.map((item) => item.vehicle).sort(), ["FIC9A98", "FIC9A99"]);
  assert.ok(list.data.items.every((item) => !item.ordered));
  assert.equal((await req(sbase, route + "/cobertura", {
    coleta: id, ids: ["7f30271a-82e5-493a-80fd-e99e6ba4db91"],
  }, operatorToken)).status, 400);
  stillPending = false;
  const second = await collect(payload);
  assert.equal(second.status, 202);
  assert.equal(await intake.runCycle(db.pool, {}, { client }), true);
  assert.equal((await get("?coleta=" + second.data.id)).data.total, 0);
  assert.equal((await get("")).data.total, 2);
});
