const { test } = require("node:test");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const { testDatabase } = require("./helpers/database.cjs"),
  { migrate } = require("../scripts/migrate");
const { prepareEquipment } = require("../src/equipment-plan");
test("existing additional OS gain a parent link without changing completed service data or historical values", async () => {
  const db = await testDatabase();
  try {
    const client = await db.pool.connect();
    try {
      await client.query(
        "CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
      );
      const directory = path.join(__dirname, "../migrations");
      for (const name of (await fs.readdir(directory))
        .filter((n) => n.endsWith(".sql") && n < "008_")
        .sort()) {
        await client.query(
          await fs.readFile(path.join(directory, name), "utf8"),
        );
        await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
          name,
        ]);
      }
    } finally {
      client.release();
    }
    for (const [id, notes, equipment] of [
      ["OS-LEGACY", "Atendimento registrado", ["tracker"]],
      ["OS-LEGACY_EXTRA", "Ref: Rastreador Extra", ["tracker_extra"]],
    ])
      await db.pool.query(
        "INSERT INTO zc_orders(id,vehicle,customer_name,service,status,notes,document_data,raw_legacy,created_date,updated_at) VALUES($1,'LEG1A23','Cliente fictício',$2,'CONCLUÍDO',$3,$4::jsonb,$5::jsonb,'2020-01-01','2020-01-01')",
        [
          id,
          id.endsWith("_EXTRA") ? "Instalação (Adicional)" : "Instalação",
          notes,
          JSON.stringify({ equipment }),
          JSON.stringify({ historical_paid_cents: 7500 }),
        ],
      );
    const before = (await db.pool.query("SELECT * FROM zc_orders ORDER BY id"))
      .rows;
    await migrate(db.pool);
    await migrate(db.pool);
    const after = (await db.pool.query("SELECT * FROM zc_orders ORDER BY id"))
      .rows;
    for (const [i, row] of after.entries()) {
      const {
        parent_order_id,
        additional_equipment,
        travel_fee_cents,
        ...original
      } = row;
      assert.equal(travel_fee_cents, 0);
      assert.deepEqual(original, before[i]);
    }
    assert.equal(after[1].parent_order_id, "OS-LEGACY");
    assert.equal(after[1].additional_equipment, "RASTREADOR");
    const edited = {};
    prepareEquipment(
      edited,
      { document_data: { equipment: ["tracker_extra"] } },
      after[1],
    );
    assert.deepEqual(JSON.parse(edited.document_data).equipment, ["tracker"]);
  } finally {
    await db.close();
  }
});
