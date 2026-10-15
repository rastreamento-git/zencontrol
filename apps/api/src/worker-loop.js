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
  const done = (async () => {
    while (!stopped) {
      let worked = false,
        delay = intervalMs;
      try {
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
    done,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      wake?.();
      await done;
    },
  };
}
module.exports = { startWorker };
