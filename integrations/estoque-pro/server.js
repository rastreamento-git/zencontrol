require("dotenv").config({ quiet: true });
const { createPool } = require("./src/database");
const { createApp } = require("./src/app");
async function start() {
  const pool = createPool();
  let app;
  try {
    app = createApp(pool);
    await app.locals.ready();
    await pool.query("SELECT arquivado FROM equipamentos_seriais LIMIT 0");
    await pool.query("SELECT id FROM eventos_seriais LIMIT 0");
  } catch (error) {
    await pool.end();
    throw error;
  }
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, "0.0.0.0", () =>
    console.log(`API iniciada na porta ${port}.`),
  );
  server.on("error", async () => {
    await pool.end();
    process.exitCode = 1;
  });
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => process.exit(1), 10000).unref();
    server.close(async () => {
      await pool.end();
      clearTimeout(timer);
    });
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
if (require.main === module)
  start().catch((error) => {
    console.error(
      "Não foi possível iniciar. Verifique ambiente, conexão e migrações.",
      error.code || error.message,
    );
    process.exitCode = 1;
  });
module.exports = { start };
