export function createDecoder() {
  const worker = new Worker(new URL("./scanner.worker.js", import.meta.url), {
    type: "module",
  });
  const pending = new Map();
  let sequence = 0,
    closed = false;
  function close(reason = "Leitor encerrado.") {
    if (closed) return;
    closed = true;
    worker.terminate();
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    pending.clear();
  }
  worker.onmessage = ({ data }) => {
    const task = pending.get(data.id);
    if (!task) return;
    pending.delete(data.id);
    clearTimeout(task.timer);
    if (data.error) task.reject(new Error(data.error));
    else task.resolve(data.results);
  };
  worker.onerror = () =>
    close(
      "Não foi possível carregar o leitor. Atualize a página e tente novamente.",
    );
  function request(data, transfer = []) {
    if (closed) return Promise.reject(new Error("Leitor encerrado."));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(
        () =>
          close("O leitor não respondeu. Atualize a página e tente novamente."),
        20000,
      );
      pending.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ ...data, id }, transfer);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }
  return {
    ready: () => request({ type: "ready" }),
    decode(image, mode, profile = "accurate") {
      return request(
        {
          buffer: image.data.buffer,
          width: image.width,
          height: image.height,
          mode,
          profile,
        },
        [image.data.buffer],
      );
    },
    close,
  };
}
