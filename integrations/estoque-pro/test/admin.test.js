const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const { createApp } = require("../src/app");
const { digest } = require("../src/admin");
let db, pool, server, base, adminToken, adminId;
const env = {
  NODE_ENV: "production",
  APP_PASSWORD: "inventory-test-password",
  SESSION_SECRET: "b".repeat(48),
  CORS_ORIGINS: "https://test.example",
  ZENCONTROL_INTEGRATION_SECRET: "test-only-integration-secret-123456789012345",
};
async function request(route, body, method = "POST", token = adminToken) {
  const res = await fetch(base + "/api/" + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}
const get = (route, token = adminToken) =>
  request(route, undefined, "GET", token);
async function login(name, password) {
  return request("auth/login", { login: name, password }, "POST", null);
}
async function product() {
  const r = await request("produtos", {
    nome: "NT40",
    categoria: "RASTREADOR",
    estoque_minimo: 0,
  });
  assert.equal(r.status, 201);
  return r.body.produto.id;
}
async function enter(id, seriais) {
  const r = await request("entrada", { produto_id: id, seriais });
  assert.equal(r.status, 200);
}
async function makeUser(loginName = "operador", role = "operador") {
  const r = await request("admin/users", {
    login: loginName,
    nome: "Pessoa de teste",
    password: "new-user-password",
    papel: role,
  });
  assert.equal(r.status, 201);
  return r.body.user;
}
before(async () => {
  db = await testDatabase();
  pool = db.pool;
  await migrate(pool);
  server = createApp(pool, env).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
  const r = await login("admin", env.APP_PASSWORD);
  assert.equal(r.status, 200);
  adminToken = r.body.token;
  adminId = r.body.user.id;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
});
beforeEach(async () => {
  await pool.query(
    "TRUNCATE auditoria_admin,eventos_seriais,movimentacoes,equipamentos_seriais,estoque_tecnicos,tecnicos,produtos RESTART IDENTITY CASCADE",
  );
  await pool.query("DELETE FROM usuarios WHERE id<>$1", [adminId]);
});
test("bootstrap creates a hashed administrator; user endpoints never expose password hashes", async () => {
  const row = (await pool.query("SELECT * FROM usuarios")).rows[0];
  assert.equal(row.login, "admin");
  assert.equal(row.papel, "admin");
  assert.ok(row.senha_hash.startsWith("scrypt$"));
  assert.notEqual(row.senha_hash, env.APP_PASSWORD);
  const session = (await get("auth/session")).body;
  assert.equal(session.user.id, adminId);
  assert.equal(session.user.papel, "admin");
  const list = (await get("admin/users")).body;
  assert.ok(!JSON.stringify(list).includes("senha_hash"));
  assert.equal((await login("admin", "incorrect-password")).status, 401);
  assert.equal((await login("unknown-user", "incorrect-password")).status, 401);
});
test("operators can move stock but secret codes cannot grant administrative permissions", async () => {
  const person = await makeUser();
  const auth = await login(person.login, "new-user-password");
  assert.equal(auth.status, 200);
  const token = auth.body.token;
  for (const path of ["admin/users", "admin/backup", "admin/audit"])
    assert.equal((await get(path, token)).status, 403);
  assert.equal(
    (
      await request(
        "admin/users",
        {
          login: "intruder",
          nome: "Intruder",
          password: "intruder-password",
          papel: "admin",
        },
        "POST",
        token,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "admin/reset",
        { confirmation: "thereisnourflevel", password: "new-user-password" },
        "POST",
        token,
      )
    ).status,
    403,
  );
  const id = await product();
  assert.equal(
    (
      await request(
        "entrada",
        { produto_id: id, seriais: ["operator-serial"] },
        "POST",
        token,
      )
    ).status,
    200,
  );
  assert.equal((await get("logs")).body[0].operador, "operador");
  assert.equal(
    (await get("imeis/operator-serial/historico")).body[0].operador,
    "operador",
  );
});
test("user validation, duplicate login and deactivation revoke active sessions; own admin cannot be disabled", async () => {
  assert.equal(
    (
      await request("admin/users", {
        login: "tiny",
        nome: "Ana",
        password: "short",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("admin/users", {
        login: "invalid space",
        nome: "Ana",
        password: "valid-user-password",
      })
    ).status,
    400,
  );
  const person = await makeUser();
  assert.equal(
    (
      await request("admin/users", {
        login: "OPERADOR",
        nome: "Ana",
        password: "new-user-password",
      })
    ).status,
    409,
  );
  const token = (await login("operador", "new-user-password")).body.token;
  assert.equal((await get("produtos", token)).status, 200);
  assert.equal(
    (await request(`admin/users/${person.id}`, { ativo: false }, "PUT")).status,
    200,
  );
  assert.equal((await get("produtos", token)).status, 401);
  assert.equal(
    (await request(`admin/users/${adminId}`, { ativo: false }, "PUT")).status,
    409,
  );
  assert.equal(
    (await request(`admin/users/${adminId}`, { papel: "operador" }, "PUT"))
      .status,
    409,
  );
});
test("global trace includes archived, cancelled and current equipment with server pagination and owner filters", async () => {
  const id = await product();
  const t = (await request("tecnicos", { nome: "Ana" })).body.tecnico.id;
  await enter(id, ["matrix", "tech", "installed", "archived", "cancelled"]);
  await request("transferir", {
    produto_id: id,
    tecnico_id: t,
    seriais: ["tech", "installed", "archived"],
  });
  await request("instalar", {
    produto_id: id,
    tecnico_id: t,
    seriais: ["installed", "archived"],
  });
  await pool.query(
    "UPDATE equipamentos_seriais SET data_atualizacao=CURRENT_TIMESTAMP-INTERVAL '31 days' WHERE codigo_serial='archived'",
  );
  await request("limpeza-instalados", undefined, "DELETE");
  await request("estorno", {
    tipo_estorno: "MATRIZ",
    produto_id: id,
    seriais: ["cancelled"],
  });
  const result = (await get("rastreabilidade?pageSize=2&page=1")).body;
  assert.equal(result.total, 5);
  assert.equal(result.rows.length, 2);
  assert.equal(result.pages, 3);
  const archived = (await get("rastreabilidade?arquivo=arquivados")).body
    .rows[0];
  assert.equal(archived.codigo_serial, "archived");
  const archivedHistory = (await get("imeis/archived/historico")).body;
  assert.equal(
    new Date(archived.data_atualizacao).toISOString(),
    new Date(archivedHistory[0].data).toISOString(),
    "the last update follows the archive event rather than the old installation date",
  );
  const cancelled = (await get("rastreabilidade?status=CANCELADO")).body;
  assert.equal(cancelled.total, 1);
  assert.equal(cancelled.rows[0].origem, "historico");
  assert.equal((await get(`rastreabilidade?tecnico_id=${t}`)).body.total, 3);
  assert.equal((await get("rastreabilidade?q=matrix")).body.total, 1);
  assert.equal((await get("rastreabilidade?q=admin")).body.total, 5);
  assert.equal((await get("rastreabilidade?pageSize=101")).status, 400);
  assert.equal((await get("rastreabilidade?status=invalid")).status, 400);
  assert.equal((await get("rastreabilidade?q=a&q=b")).status, 400);
  assert.ok(
    (await get("rastreabilidade")).body.rows.every((r) => r.data_atualizacao),
  );
});
test("backup is consistent and contains inventory only; reset needs password, exact confirmation and a fresh snapshot", async () => {
  const id = await product();
  await enter(id, ["000001"]);
  const backup = (await get("admin/backup")).body;
  assert.equal(backup.format, "estoquepro-inventory");
  assert.equal(backup.checksum, digest(backup.data));
  assert.equal(backup.counts.equipamentos_seriais, 1);
  assert.ok(!JSON.stringify(backup).includes("senha_hash"));
  assert.ok(!JSON.stringify(backup).includes(env.SESSION_SECRET));
  assert.equal(
    (
      await request("admin/reset", {
        confirmation: "wrong",
        password: env.APP_PASSWORD,
        expectedChecksum: backup.checksum,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("admin/reset", {
        confirmation: "thereisnourflevel",
        password: "wrong",
        expectedChecksum: backup.checksum,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("admin/reset", {
        confirmation: "thereisnourflevel",
        password: env.APP_PASSWORD,
      })
    ).status,
    400,
  );
  await enter(id, ["000002"]);
  assert.equal(
    (
      await request("admin/reset", {
        confirmation: "thereisnourflevel",
        password: env.APP_PASSWORD,
        expectedChecksum: backup.checksum,
      })
    ).status,
    409,
  );
  assert.equal((await get("imeis")).body.length, 2);
  const fresh = (await get("admin/backup")).body;
  assert.equal(
    (
      await request("admin/reset", {
        confirmation: "thereisnourflevel",
        password: env.APP_PASSWORD,
        expectedChecksum: fresh.checksum,
        scope: "stock",
      })
    ).status,
    200,
  );
  assert.equal((await get("imeis")).body.length, 0);
  assert.equal((await get("produtos")).body.length, 1);
  assert.equal((await get("produtos")).body[0].quantidade_matriz, 0);
  assert.equal((await get("admin/users")).body.length, 1);
  assert.equal((await get("admin/audit")).body[0].acao, "RESET_INVENTARIO");
});
test("full reset preserves users, backup restores rows and serial sequences, invalid restores roll back", async () => {
  const id = await product();
  await enter(id, ["leading-00001"]);
  const source = (await get("admin/backup")).body;
  assert.equal(
    (
      await request("admin/reset", {
        confirmation: "thereisnourflevel",
        password: env.APP_PASSWORD,
        expectedChecksum: source.checksum,
        scope: "all",
      })
    ).status,
    200,
  );
  assert.equal((await get("produtos")).body.length, 0);
  assert.equal((await get("admin/users")).body[0].id, adminId);
  const empty = (await get("admin/backup")).body;
  assert.equal(
    (
      await request("admin/restore", {
        confirmation: "restaurar",
        password: env.APP_PASSWORD,
        expectedChecksum: empty.checksum,
        backup: source,
      })
    ).status,
    200,
  );
  assert.equal((await get("imeis")).body[0].codigo_serial, "leading-00001");
  assert.equal((await get("imeis/leading-00001/historico")).body.length, 1);
  const next = (await request("produtos", { nome: "Next", categoria: "TAG" }))
    .body.produto.id;
  assert.ok(next > id);
  const current = (await get("admin/backup")).body;
  const bad = structuredClone(source);
  bad.data.equipamentos_seriais[0].produto_id = 99999;
  bad.checksum = digest(bad.data);
  const restore = await request("admin/restore", {
    confirmation: "restaurar",
    password: env.APP_PASSWORD,
    expectedChecksum: current.checksum,
    backup: bad,
  });
  assert.equal(restore.status, 409);
  assert.equal((await get("produtos")).body.length, 2);
  assert.equal((await get("imeis")).body.length, 1);
  const damaged = structuredClone(source);
  damaged.data.produtos[0].nome = "Modified without digest";
  assert.equal(
    (
      await request("admin/restore", {
        confirmation: "restaurar",
        password: env.APP_PASSWORD,
        expectedChecksum: current.checksum,
        backup: damaged,
      })
    ).status,
    400,
  );
});

test("legacy inventory backups retain integrity and receive an empty integration ledger", async () => {
  const { validateBackup } = require("../src/admin");
  const source = (await get("admin/backup")).body;
  delete source.data.zencontrol_installations;
  source.checksum = digest(source.data);
  const compatible = validateBackup(source);
  assert.deepEqual(compatible.data.zencontrol_installations, []);
  source.data.produtos.push({ id: 99 });
  assert.throws(() => validateBackup(source), /integridade/);
});
test("installation receipts survive backup and restore with their request identity", async (t) => {
  // A fresh app isolates the security limiter from other destructive-action tests.
  const previousBase = base;
  const isolated = createApp(pool, env).listen(0, "127.0.0.1");
  await new Promise((r) => isolated.once("listening", r));
  base = "http://127.0.0.1:" + isolated.address().port;
  t.after(async () => {
    base = previousBase;
    await new Promise((r) => isolated.close(r));
  });
  const id = await product(),
    code = "receipt-backup-001";
  await enter(id, [code]);
  const tid = (await request("tecnicos", { nome: "Técnico recibo" })).body
    .tecnico.id;
  assert.equal(
    (
      await request("transferir", {
        produto_id: id,
        tecnico_id: tid,
        seriais: [code],
      })
    ).status,
    200,
  );
  const payload = {
    source_system: "backup-test",
    order_id: "OS-BACKUP-TEST",
    submission_id: "submission-backup-test",
    technician_id: tid,
    serials: [code],
    operator: "Teste",
  };
  const install = async () => {
    const r = await fetch(base + "/api/integrations/zencontrol/installations", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.ZENCONTROL_INTEGRATION_SECRET,
        "Content-Type": "application/json",
        "Idempotency-Key": "stock:backup:test-001",
      },
      body: JSON.stringify(payload),
    });
    return { status: r.status, body: await r.json() };
  };
  const first = await install();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const source = (await get("admin/backup")).body;
  assert.equal(source.data.zencontrol_installations.length, 1);
  assert.equal(
    (
      await request("admin/reset", {
        confirmation: "thereisnourflevel",
        password: env.APP_PASSWORD,
        expectedChecksum: source.checksum,
        scope: "all",
      })
    ).status,
    200,
  );
  const current = (await get("admin/backup")).body;
  const restored = await request("admin/restore", {
    confirmation: "restaurar",
    password: env.APP_PASSWORD,
    backup: source,
    expectedChecksum: current.checksum,
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  const retry = await install();
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.receipt_id, first.body.receipt_id);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer n FROM movimentacoes WHERE tipo='USO_FINAL'",
      )
    ).rows[0].n,
    1,
  );
});
