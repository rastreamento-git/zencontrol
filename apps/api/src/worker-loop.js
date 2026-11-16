const { runOne } = require("./jobs");
function startWorker(
  pool,
  cfg,
  {
    execute = runOne,
    intervalMs = 3000,
    errorDelayMs = 5000,
    onError = (error) =>
      console.error("Falha no ciclo:", error.code || error.name),
  } = {},
) {
  let stopped = false,
    timer,
    wake;
  // Intake runs separately so a slow SGA read does not hold stock confirmations.
  const controller = new AbortController();
  const intakeWorker =
    execute === runOne && cfg.SGA_READ_ENABLED
      ? startWorker(pool, cfg, {
          intervalMs: 30000,
          execute: (db, config) =>
            require("./sga-intake").runCycle(db, config, {
              signal: controller.signal,
            }),
          onError,
        })
      : null;
  let nextStorageCheck = 0;
  const done = (async () => {
    while (!stopped) {
      let worked = false,
        delay = intervalMs;
      try {
        if (execute === runOne && Date.now() >= nextStorageCheck) {
          nextStorageCheck = Date.now() + 60 * 60 * 1000;
          try { await require("./storage-policy").reconcile(pool); } catch(error) { onError(error); }
        }
        worked = await execute(pool, cfg);
      } catch (error) {
        onError(error);
        delay = errorDelayMs;
      }
      if (!worked && !stopped)
        await new Promise((resolve) => {
          wake = resolve;
          timer = setTimeout(() => {
            timer = undefined;
            wake = undefined;
            resolve();
          }, delay);
        });
    }
  })();
  return {
    done: intakeWorker ? Promise.all([done, intakeWorker.done]) : done,
    async stop() {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      wake?.();
      await Promise.all([done, intakeWorker?.stop()]);
    },
  };
}
module.exports = { startWorker };
