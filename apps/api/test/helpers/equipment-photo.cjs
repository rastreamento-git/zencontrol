const { readFileSync } = require("node:fs");
const { prepareZXingModule, writeBarcode } = require("zxing-wasm/writer");
const sharp = require("sharp");
prepareZXingModule({
  overrides: {
    wasmBinary: readFileSync(
      require.resolve("zxing-wasm/writer/zxing_writer.wasm"),
    ),
  },
});
async function barcode(code, format = "Code128", options = {}) {
  const output = await writeBarcode(code, {
    format,
    scale: 4,
    addQuietZones: true,
    ...options,
  });
  if (output.error) throw Error(output.error);
  return Buffer.from(await output.image.arrayBuffer());
}
async function photo(code, format = "Code128") {
  const bytes = await sharp(await barcode(code, format))
    .jpeg({ quality: 90 })
    .toBuffer();
  return "data:image/jpeg;base64," + bytes.toString("base64");
}
module.exports = { barcode, photo };
