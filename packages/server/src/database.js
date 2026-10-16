const { Pool } = require("pg");
function databaseConfig(env = process.env) {
  if (!env.DATABASE_URL)
    throw new Error("Configure DATABASE_URL antes de iniciar.");
  const url = new URL(env.DATABASE_URL);
  // SSL is configured here so connection-string options cannot override certificate verification.
  for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"])
    url.searchParams.delete(key);
  const mode = env.DATABASE_SSL || "verify-full";
  if (!["disable", "require", "verify-full"].includes(mode))
    throw new Error("DATABASE_SSL deve ser disable, require ou verify-full.");
  const max = Number(env.DATABASE_POOL_MAX || 3);
  if (!Number.isInteger(max) || max < 1 || max > 20)
    throw new Error("DATABASE_POOL_MAX deve ser um inteiro entre 1 e 20.");
  const options = {
    connectionString: url.toString(),
    max,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    options:
      "-c timezone=America/Sao_Paulo -c statement_timeout=15000 -c lock_timeout=10000",
    ssl:
      mode === "disable"
        ? false
        : { rejectUnauthorized: mode === "verify-full" },
  };
  if (env.DATABASE_CA && options.ssl)
    options.ssl.ca = env.DATABASE_CA.replace(/\\n/g, "\n");
  return options;
}
function createPool(env) {
  const pool = new Pool(databaseConfig(env));
  pool.on("error", () =>
    console.error("Erro em conexão ociosa do PostgreSQL."),
  );
  return pool;
}
// All statements of a transaction use the same checked-out connection.
// A transaction advisory lock serializes stock writes across API instances.
async function transaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(73102418)");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* original error preserved */
    }
    throw error;
  } finally {
    client.release();
  }
}
module.exports = { createPool, databaseConfig, transaction };
