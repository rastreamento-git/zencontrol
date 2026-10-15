import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { decodePixels } from "./scanner";

const ready = prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) =>
      path.endsWith(".wasm") ? wasmUrl : prefix + path,
  },
  fireImmediately: true,
});
// WASM is emitted as a versioned asset on our own origin, never a CDN.
self.onmessage = async ({ data }) => {
  try {
    await ready;
    const results =
      data.type === "ready"
        ? []
        : await decodePixels(
            new ImageData(
              new Uint8ClampedArray(data.buffer),
              data.width,
              data.height,
            ),
            data.mode,
            readBarcodes,
            data.profile,
          );
    self.postMessage({
      id: data.id,
      results: results.map(({ text, format, isValid }) => ({
        text,
        format,
        isValid,
      })),
    });
  } catch {
    self.postMessage({
      id: data.id,
      error:
        "Falha ao carregar ou executar o leitor. Atualize a página e tente novamente.",
    });
  }
};
