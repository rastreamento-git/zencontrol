const { configuration } = require("./src/config");
const { createPool } = require("./src/database");
const { createApp } = require("./src/app");
const { startWorker } = require("./src/worker-loop");
const cfg = configuration();
const pool = createPool(cfg);
const app = createApp(pool, cfg);
app.locals
  .ready()
  .then(() => {
    const worker = cfg.RUN_WORKER ? startWorker(pool, cfg) : null;
    const server = app.listen(
      Number(cfg.PORT || 3000),
      cfg.HOST || "127.0.0.1",
      () => console.log("ZenControl disponível na porta " + (cfg.PORT || 3000)),
    );
    let stopping = false;
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => {
        if (stopping) return;
        stopping = true;
        const done = worker?.stop();
        server.close(async () => {
          await done;
          await pool.end();
          process.exit(0);
        });
      });
  })
  .catch((e) => {
    console.error("Falha ao iniciar:", e.code || e.message);
    pool.end();
    process.exitCode = 1;
  });
