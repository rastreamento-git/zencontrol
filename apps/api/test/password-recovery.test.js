const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { once } = require("node:events");
const { setTimeout: wait } = require("node:timers/promises");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const { createApp } = require("../src/app");

test("primeiro acesso individual e recuperação por e-mail com expiração, uso único e revogação de sessões", async (t) => {
  const db = await testDatabase();
  let server;
  t.after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
    await db.close();
  });
  const localFetch = globalThis.fetch;
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    sent.push(JSON.parse(options.body));
    return new Response(null, { status: 200 });
  });
  await migrate(db.pool);
  const password = "Somente1!Teste";
  const app = createApp(db.pool, {
    APP_PASSWORD: password,
    SESSION_SECRET: "password-recovery-test-secret-123456789",
    ZEN_WEBHOOK_SECRET: "password-recovery-webhook-123456789",
    SSO_LOGIN_URL: "https://login.example.test",
    TECHNICIAN_PORTAL_URL: "https://field.example.test",
    SSO_STOCK_URL: "https://stock.example.test",
    RESEND_API_KEY: "test-only",
    PASSWORD_RESET_FROM: "contas@example.test",
  });
  await app.locals.ready();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  async function call(path, body, token) {
    const res = await localFetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  }
  const login = (name, secret) =>
    call("/auth/login", {
      login: name,
      password: secret,
      audience: "ecosystem",
    });
  const admin = await login("admin", password);
  assert.equal(admin.status, 200);
  const create = await call(
    "/technicians",
    {
      name: "José Fictício",
      recovery_email: "  jose@example.test  ",
    },
    admin.data.token,
  );
  assert.equal(create.status, 200);
  const access = create.data.access;
  assert.ok(access.temporary_password.length >= 12);
  assert.equal(access.code, undefined);
  const first = await login(access.login, access.temporary_password);
  assert.equal(first.status, 200);
  assert.deepEqual(first.data, { password_change_required: true });
  const activation = {
    login: access.login,
    password: access.temporary_password,
    new_password: password,
  };
  assert.equal(
    (
      await call("/auth/activate", {
        ...activation,
        new_password: access.temporary_password,
      })
    ).status,
    400,
  );
  assert.equal((await call("/auth/activate", activation)).status, 200);
  assert.equal((await call("/auth/activate", activation)).status, 401);
  const session = await login(access.login, password);
  assert.equal(session.status, 200);

  const unknown = await call("/auth/password/forgot", {
    identifier: "outro@example.test",
  });
  const accepted = await call("/auth/password/forgot", {
    identifier: "JOSE@example.test",
    to: "nao-cadastrado@example.test",
  });
  assert.deepEqual(unknown, accepted);
  assert.equal(accepted.status, 202);
  await call("/auth/password/forgot", { identifier: access.login });
  for (let i = 0; i < 50 && !sent.length; i++) await wait(20);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ["jose@example.test"]);
  const url = new URL(sent[0].text.split("\n\n").at(-1));
  assert.equal(url.origin, "https://login.example.test");
  assert.equal(url.search, "");
  const token = new URLSearchParams(url.hash.slice(1)).get("redefinir");
  const digest = createHash("sha256").update(token).digest("hex");
  assert.equal(
    (await db.pool.query("SELECT token_hash FROM zc_password_resets")).rows[0]
      .token_hash,
    digest,
  );
  const reset = { token, new_password: "Definitiva1!Nova" };
  await db.pool.query(
    "UPDATE zc_password_resets SET expires_at=now()-interval '1 minute'",
  );
  assert.equal((await call("/auth/password/reset", reset)).status, 400);
  await db.pool.query(
    "UPDATE zc_password_resets SET expires_at=now()+interval '1 minute'",
  );
  const attempts = await Promise.all([
    call("/auth/password/reset", reset),
    call("/auth/password/reset", reset),
  ]);
  assert.deepEqual(attempts.map((a) => a.status).sort(), [200, 400]);
  assert.equal((await call("/meta", null, session.data.token)).status, 401);
  assert.equal((await login(access.login, password)).status, 401);
  assert.equal((await login(access.login, reset.new_password)).status, 200);
});
