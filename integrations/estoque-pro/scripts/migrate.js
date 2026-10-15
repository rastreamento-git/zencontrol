require("dotenv").config({ quiet: true });
const fs = require("node:fs/promises");
const path = require("node:path");
const { createPool, transaction } = require("../src/database");
async function migrate(pool) {
  const directory = path.join(__dirname, "../migrations");
  const names = (await fs.readdir(directory))
    .filter((n) => n.endsWith(".sql"))
    .sort();
  await transaction(pool, async (client) => {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    );
    for (const name of names) {
      if (
        (
          await client.query(
            "SELECT name FROM schema_migrations WHERE name=$1",
            [name],
          )
        ).rowCount
      )
        continue;
      await client.query(await fs.readFile(path.join(directory, name), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
        name,
      ]);
    }
  });
}
if (require.main === module) {
  const pool = createPool();
  migrate(pool)
    .then(() => console.log("Migrações aplicadas."))
    .catch((error) => {
      console.error(
        "Migração falhou; nenhuma alteração desta execução foi confirmada.",
        error.code || error.message,
      );
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
module.exports = { migrate };
