const { test } = require("node:test");
const assert = require("node:assert/strict");
const { databaseConfig, transaction } = require("../src/database");
const { createApp } = require("../src/app");
test("verifies TLS by default and connection strings cannot override explicit SSL policy", () => {
  const config = databaseConfig({
    DATABASE_URL:
      "postgresql://user:password@localhost/db?ssl=false&sslmode=no-verify",
    DATABASE_CA: "line1\\nline2",
  });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.ca, "line1\nline2");
  assert.equal(new URL(config.connectionString).searchParams.has("ssl"), false);
  assert.equal(
    databaseConfig({
      DATABASE_URL: "postgresql://localhost/db",
      DATABASE_SSL: "disable",
    }).ssl,
    false,
  );
  assert.throws(() => databaseConfig({}));
  assert.throws(() =>
    databaseConfig({
      DATABASE_URL: "postgresql://localhost/db",
      DATABASE_SSL: "typo",
    }),
  );
});
test("production refuses missing password, session secret and CORS origins", () => {
  const pool = {};
  assert.throws(() => createApp(pool, { NODE_ENV: "production" }));
  assert.throws(() =>
    createApp(pool, {
      NODE_ENV: "production",
      CORS_ORIGINS: "https://example.com",
    }),
  );
  assert.throws(() =>
    createApp(pool, {
      NODE_ENV: "production",
      CORS_ORIGINS: "https://example.com",
      APP_PASSWORD: "strong-enough-password",
    }),
  );
  assert.throws(() => createApp(pool, { CORS_ORIGINS: "*" }));
});
test("transaction never sends statements through pool.query and releases connection after rollback", async () => {
  const statements = [];
  let released = false;
  const client = {
    query: async (sql) => {
      statements.push(sql);
    },
    release: () => {
      released = true;
    },
  };
  const pool = {
    connect: async () => client,
    query: () => {
      throw new Error("Pool query must not be used inside transactions.");
    },
  };
  await assert.rejects(
    transaction(pool, async (leased) => {
      assert.equal(leased, client);
      await leased.query("UPDATE example");
      throw new Error("rollback required");
    }),
  );
  assert.deepEqual(statements, [
    "BEGIN",
    "SELECT pg_advisory_xact_lock(73102418)",
    "UPDATE example",
    "ROLLBACK",
  ]);
  assert.equal(released, true);
});
