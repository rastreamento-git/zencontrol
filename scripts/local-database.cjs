// Local PostgreSQL WASM only. This adapter never accepts a remote connection URL.
const { PGlite } = require("@electric-sql/pglite");
async function localDatabase(directory, options = {}) {
  const db = await PGlite.create({ dataDir: directory, ...options });
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
// One engine with separate application schemas for the memory-limited online demo.
// Selecting search_path is protected by the SAME lease as the entire transaction.
async function schemaDatabase(database, schema) {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(schema))
    throw Error("Schema de demonstração inválido.");
  await database.pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  async function connect() {
    const client = await database.pool.connect();
    try {
      await client.query(`SET search_path TO "${schema}"`);
      return client;
    } catch (error) {
      client.release();
      throw error;
    }
  }
  return {
    pool: {
      connect,
      async query(sql, args) {
        const client = await connect();
        try {
          return await client.query(sql, args);
        } finally {
          client.release();
        }
      },
    },
    close: async () => {},
  };
}
module.exports = { localDatabase, schemaDatabase };
