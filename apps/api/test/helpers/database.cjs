const { randomUUID } = require("node:crypto");
async function testDatabase() {
  if (process.env.TEST_DATABASE_URL) {
    const { Pool } = require("pg");
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 8,
      options: `-c search_path=${schema} -c timezone=America/Sao_Paulo`,
    });
    return {
      pool,
      engine: "PostgreSQL",
      close: async () => {
        await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      },
    };
  }
  // Runs actual PostgreSQL SQL through PGlite. It has one connection; concurrency is queued.
  const { PGlite } = require("@electric-sql/pglite");
  const db = await PGlite.create();
  await db.query("SET TIME ZONE 'America/Sao_Paulo'");
  let tail = Promise.resolve();
  async function lease() {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }
  async function query(sql, params) {
    const result = await db.query(sql, params);
    return {
      ...result,
      rowCount:
        result.command === "SELECT"
          ? result.rows.length
          : (result.affectedRows ?? result.rows.length),
    };
  }
  const pool = {
    async connect() {
      const release = await lease();
      return {
        query: async (sql, params) => {
          if (!params && sql.includes(";")) {
            await db.exec(sql);
            return { rowCount: 0, rows: [] };
          }
          return query(sql, params);
        },
        release,
      };
    },
    async query(sql, params) {
      const release = await lease();
      try {
        return await query(sql, params);
      } finally {
        release();
      }
    },
  };
  return { pool, engine: "PGlite (PostgreSQL WASM)", close: () => db.close() };
}
module.exports = { testDatabase };
