const test = require("node:test"),
  assert = require("node:assert/strict");
const { configuration, gateway } = require("./online-demo.cjs");
const http = require("node:http");
test("shared demo engine isolates both migrations and concurrent transactions by schema", async () => {
  const { localDatabase, schemaDatabase } = require("./local-database.cjs");
  const db = await localDatabase();
  try {
    const a = (await schemaDatabase(db, "first_demo")).pool;
    const b = (await schemaDatabase(db, "second_demo")).pool;
    for (const pool of [a, b])
      await pool.query("CREATE TABLE sample (value TEXT)");
    await Promise.all([
      a.query("INSERT INTO sample VALUES('central')"),
      b.query("INSERT INTO sample VALUES('stock')"),
    ]);
    const tx = await a.connect();
    await tx.query("BEGIN");
    await tx.query("INSERT INTO sample VALUES('rolled back')");
    const pending = b.query("SELECT * FROM sample");
    await tx.query("ROLLBACK");
    tx.release();
    assert.deepEqual((await pending).rows, [{ value: "stock" }]);
    assert.deepEqual((await a.query("SELECT * FROM sample")).rows, [
      { value: "central" },
    ]);
  } finally {
    await db.close();
  }
});
const env = {
  RENDER: "true",
  RENDER_EXTERNAL_URL: "https://central-demo.onrender.com",
  ONLINE_FIELD_URL: "https://field-demo.onrender.com",
  ONLINE_STOCK_URL: "https://stock-demo.onrender.com",
  ONLINE_DEMO_PASSWORD: "fictitious-test-only-password",
  ONLINE_DEMO_SECRET: "x".repeat(32),
};
test("online mode rejects remote credentials and requires explicit demo secrets", () => {
  assert.equal(configuration(env).port, 10000);
  assert.equal(configuration(env).centralOrigin, env.RENDER_EXTERNAL_URL);
  assert.equal(configuration({ ...env, ONLINE_CENTRAL_URL: "https://central-demo.vercel.app" }).centralOrigin, "https://central-demo.vercel.app");
  for (const address of ["http://example.com", "https://example.com/path", "https://user:password@example.com", "https://example.com?query=1"]) {
    assert.throws(() => configuration({ ...env, ONLINE_CENTRAL_URL: address }));
  }
  for (const key of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "STOCK_API_URL",
  ])
    assert.throws(
      () => configuration({ ...env, [key]: "forbidden" }),
      /não aceita conexões externas/,
    );
  assert.throws(() => configuration({ ...env, RENDER: "false" }));
  assert.throws(() =>
    configuration({ ...env, ONLINE_DEMO_PASSWORD: "zen123" }),
  );
  assert.throws(() =>
    configuration({ ...env, ONLINE_FIELD_URL: "http://example.com" }),
  );
  assert.throws(() =>
    configuration({ ...env, ONLINE_STOCK_URL: "https://example.com/path" }),
  );
});
test("public gateway keeps API path/body/query and forwards only the trusted client IP", async () => {
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        path: req.url,
        body: Buffer.concat(chunks).toString(),
        forwarded: req.headers["x-forwarded-for"],
      }),
    );
  });
  await new Promise((r) => upstream.listen(4318, "127.0.0.1", r));
  const server = gateway({
    fixtures: "/nonexistent",
    config: configuration(env),
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.on("listening", r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const r = await fetch(base + "/stock-api/api/check?a=1", {
      method: "POST",
      body: '{"sample":true}',
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "untrusted, 192.0.2.4",
      },
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.path, "/api/check?a=1");
    assert.equal(data.body, '{"sample":true}');
    assert.equal(data.forwarded, "192.0.2.4");
    assert.match(r.headers.get("x-robots-tag"), /noindex/);
    const info = await (await fetch(base + "/demo-info")).json();
    assert.equal(info.ephemeral, true);
    assert.ok(!JSON.stringify(info).includes(env.ONLINE_DEMO_PASSWORD));
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => upstream.close(r));
  }
});
