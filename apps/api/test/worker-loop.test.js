const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startWorker } = require("../src/worker-loop");
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
test("encerramento acorda uma fila ociosa sem esperar o intervalo", async () => {
  const called = deferred();
  let calls = 0;
  const loop = startWorker(
    null,
    {},
    {
      intervalMs: 60000,
      execute: async () => {
        calls++;
        called.resolve();
        return false;
      },
    },
  );
  await called.promise;
  await loop.stop();
  assert.equal(calls, 1);
});
test("encerramento aguarda a tarefa ativa e não inicia a próxima", async () => {
  const called = deferred(),
    finish = deferred();
  let calls = 0,
    stopped = false;
  const loop = startWorker(
    null,
    {},
    {
      execute: async () => {
        calls++;
        called.resolve();
        await finish.promise;
        return true;
      },
    },
  );
  await called.promise;
  const stopping = loop.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  finish.resolve();
  await stopping;
  assert.equal(stopped, true);
  assert.equal(calls, 1);
});
test("falha do ciclo é informada e pode encerrar sem travar o processo", async () => {
  const caught = deferred();
  let errors = 0;
  const loop = startWorker(
    null,
    {},
    {
      errorDelayMs: 60000,
      execute: async () => {
        throw Error("erro simulado");
      },
      onError: () => {
        errors++;
        caught.resolve();
      },
    },
  );
  await caught.promise;
  await loop.stop();
  assert.equal(errors, 1);
});
test("fila executa tarefas em sequência sem sobrepor ciclos", async () => {
  const called = deferred();
  let calls = 0,
    active = 0,
    max = 0;
  const loop = startWorker(
    null,
    {},
    {
      intervalMs: 60000,
      execute: async () => {
        calls++;
        active++;
        max = Math.max(max, active);
        await new Promise((r) => setImmediate(r));
        active--;
        if (calls === 4) called.resolve();
        return calls < 4;
      },
    },
  );
  await called.promise;
  await loop.stop();
  assert.equal(calls, 4);
  assert.equal(max, 1);
});
