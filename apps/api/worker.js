const { configuration } = require("./src/config");
const { createPool } = require("./src/database");
const { startWorker } = require("./src/worker-loop");
const cfg = configuration(),
  pool = createPool(cfg);
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
