const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const { testDatabase } = require("./helpers/database.cjs"),
  { migrate } = require("../scripts/migrate"),
  f = require("../src/finance-engine"),
  d = require("../src/domain");
test("migration preserves unknown legacy payment history without declaring it paid or payable", async () => {
  const db = await testDatabase();
  try {
    const client = await db.pool.connect();
    try {
      await client.query(
        "CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
      );
      for (const name of [
        "001_zencontrol.sql",
        "002_portal_and_stock.sql",
        "003_order_document.sql",
        "004_technician_capture.sql",
      ]) {
        await client.query(
          await fs.readFile(
            path.join(__dirname, "../migrations", name),
            "utf8",
          ),
        );
        await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
          name,
        ]);
      }
    } finally {
      client.release();
    }
    const tid = (
      await db.pool.query(
        "INSERT INTO zc_technicians(name) VALUES('Legado fictício') RETURNING id",
      )
    ).rows[0].id;
    await db.pool.query(
      "INSERT INTO zc_settlements(id,technician_id,start_date,end_date,total_cents,snapshot,created_at,created_by) VALUES('legacy-closing',$1,'2020-01-01','2020-01-31',9000,'{}',$2,'legacy')",
      [tid, d.now()],
    );
    await migrate(db.pool);
    const result = await f.summary(db.pool, tid);
    assert.equal(result.settlements[0].state, "legacy_unverified");
    assert.equal(result.settlements[0].balance_cents, null);
    assert.equal(result.balance_cents, 0);
    assert.equal(result.unverified_cents, 9000);
  } finally {
    await db.close();
  }
});
