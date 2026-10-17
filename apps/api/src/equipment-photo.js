const { readFileSync } = require("node:fs");
const { prepareZXingModule, readBarcodes } = require("zxing-wasm/reader");
const { fail } = require("./errors");
const { StockClient } = require("./stock-client");

// Ship the decoder with the server: no CDN, paid OCR API or remote image upload.
prepareZXingModule({
  overrides: {
    wasmBinary: readFileSync(
      require.resolve("zxing-wasm/reader/zxing_reader.wasm"),
    ),
  },
});
let tail = Promise.resolve();
async function decodeEquipmentPhoto(bytes) {
  // Bound peak WASM memory by decoding one photograph at a time.
  const task = tail.then(async () => {
    const results = await readBarcodes(bytes, {
      formats: [
        "QRCode",
        "DataMatrix",
        "Code128",
        "Code39",
        "Code93",
        "EAN13",
        "EAN8",
        "UPCA",
        "UPCE",
        "ITF",
        "Codabar",
      ],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      tryDownscale: true,
      minLineCount: 3,
      maxNumberOfSymbols: 16,
      returnErrors: false,
      textMode: "Plain",
    });
    return [
      ...new Set(
        results
          .filter((r) => r.isValid && !r.error && typeof r.text === "string")
          .map((r) => r.text.trim())
          .filter((t) => t && t.length <= 2048),
      ),
    ];
  });
  tail = task.catch(() => {});
  return task;
}
function candidates(text) {
  const values = new Set([text.trim()]);
  // Accept common labelled, JSON and URL QR payloads. Never visit QR URLs.
  const add = (value) => {
    if (typeof value === "string" || typeof value === "number")
      values.add(String(value).trim());
  };
  try {
    const object = JSON.parse(text);
    if (object && typeof object === "object")
      for (const key of ["imei", "IMEI", "serial", "codigo_serial", "sn", "SN"])
        add(object[key]);
  } catch {}
  try {
    const url = new URL(text);
    for (const key of ["imei", "serial", "codigo_serial", "sn"])
      add(url.searchParams.get(key));
  } catch {}
  for (const match of text.matchAll(
    /(?:IMEI|SERIAL|S\/N|SN)\s*[:=]\s*([a-z0-9_-]{1,128})/gi,
  ))
    add(match[1]);
  return values;
}
function matchEquipment(texts, items) {
  const values = new Set(texts.flatMap((t) => [...candidates(t)]));
  const matched = items.filter((item) => values.has(item.codigo_serial));
  if (!matched.length)
    fail(
      400,
      "O código da foto não corresponde a um equipamento na sua carga. Fotografe a etiqueta do rastreador ou da TAG; se persistir, fale com a central.",
    );
  if (matched.length > 1)
    fail(
      400,
      "A foto mostra mais de um equipamento. Envie uma foto por rastreador ou TAG.",
    );
  const item = matched[0];
  const type = String(item.categoria).toUpperCase();
  if (!["RASTREADOR", "TAG"].includes(type))
    fail(
      400,
      "O código não identifica um rastreador ou TAG. Confira a etiqueta e o cadastro com a central.",
    );
  return {
    serial_code: item.codigo_serial,
    equipment_type: type,
    equipment_model: item.produto,
  };
}
async function identifyEquipment(bytes, technician, cfg) {
  let texts;
  try {
    texts = await decodeEquipmentPhoto(bytes);
  } catch {
    fail(503, "Não foi possível analisar a foto. Tente enviá-la novamente.");
  }
  if (!texts.length)
    fail(
      400,
      "Foto do equipamento ilegível: não conseguimos ler o código de barras ou QR Code. Aproxime a etiqueta, evite reflexos e tire outra foto com boa luz.",
    );
  if (!technician.stock_technician_id)
    fail(
      409,
      "Peça à central para vincular seu cadastro ao Estoque Pro antes de fotografar o equipamento.",
    );
  let load;
  try {
    load = await new StockClient(cfg).items(technician.stock_technician_id);
  } catch {
    fail(
      503,
      "A consulta ao estoque está indisponível. Sua foto ainda não foi salva. Aguarde um pouco e envie novamente.",
    );
  }
  return matchEquipment(texts, load.items || []);
}
module.exports = { decodeEquipmentPhoto, matchEquipment, identifyEquipment };
