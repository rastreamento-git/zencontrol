// Local PostgreSQL WASM only. This adapter never accepts a remote connection URL.
const { PGlite } = require("@electric-sql/pglite");
async function localDatabase(directory) {
  const db = await PGlite.create(directory);
  await db.query("SET TIME ZONE 'America/Sao_Paulo'");
  let tail = Promise.resolve();
  async function lease() {
    const previous = tail;
    let release;
    tail = new Promise((r) => {
      release = r;
    });
    await previous;
    return release;
  }
  async function query(sql, args) {
    if (!args && sql.includes(";")) {
      await db.exec(sql);
      return { rows: [], rowCount: 0 };
    }
    const r = await db.query(sql, args);
    return {
      ...r,
      rowCount:
        r.command === "SELECT"
          ? r.rows.length
          : (r.affectedRows ?? r.rows.length),
    };
  }
  const pool = {
    async connect() {
      const release = await lease();
      return { query, release };
    },
    async query(sql, args) {
      const release = await lease();
      try {
        return await query(sql, args);
      } finally {
        release();
      }
    },
  };
  return { pool, close: () => db.close() };
}
module.exports = { localDatabase };
