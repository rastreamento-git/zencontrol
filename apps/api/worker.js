const { configuration } = require("./src/config");
const { createPool } = require("./src/database");
const { startWorker } = require("./src/worker-loop");
const { createMediaStore } = require("./src/media-store");
const cfg = configuration(),
  pool = createPool(cfg);
async function main() {
  await createMediaStore(cfg).ready();
  const worker = startWorker(pool, cfg);
  console.log(
    "Worker ZenControl iniciado. Integrações: " + cfg.INTEGRATIONS_ENABLED,
  );
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      await worker.stop();
      await pool.end();
    });
  worker.done.catch(async () => {
    process.exitCode = 1;
    await pool.end();
  });
}
main().catch(async (error) => {
  console.error("Falha ao iniciar worker:", error.code || error.message);
  process.exitCode = 1;
  await pool.end();
});
