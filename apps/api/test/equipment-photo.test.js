const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { barcode } = require("./helpers/equipment-photo.cjs");
const {
  decodeEquipmentPhoto,
  matchEquipment,
} = require("../src/equipment-photo");
const tracker = {
  codigo_serial: "123456789012345",
  categoria: "RASTREADOR",
  produto: "Rastreador teste",
};
const tag = {
  codigo_serial: "TAG-0012",
  categoria: "TAG",
  produto: "TAG teste",
};
test("decodes real rotated, off-center JPEG barcodes and inverted QR codes without a network service", async () => {
  const bars = await sharp(await barcode(tracker.codigo_serial))
    .rotate(90)
    .extend({ top: 80, right: 240, bottom: 30, left: 60, background: "white" })
    .jpeg({ quality: 85 })
    .toBuffer();
  assert.deepEqual(await decodeEquipmentPhoto(bars), [tracker.codigo_serial]);
  const qr = await barcode(
    JSON.stringify({ serial: tag.codigo_serial }),
    "QRCode",
    { invert: true },
  );
  assert.deepEqual(
    matchEquipment(await decodeEquipmentPhoto(qr), [tracker, tag]),
    {
      serial_code: tag.codigo_serial,
      equipment_type: "TAG",
      equipment_model: tag.produto,
    },
  );
});
test("supports DataMatrix and labelled/URL payloads; ignores unrelated barcode values", async () => {
  const matrix = await barcode("IMEI: " + tracker.codigo_serial, "DataMatrix");
  assert.equal(
    matchEquipment(await decodeEquipmentPhoto(matrix), [tracker, tag])
      .serial_code,
    tracker.codigo_serial,
  );
  assert.equal(
    matchEquipment(
      ["sim-unrelated", "https://example.invalid/device?serial=TAG-0012"],
      [tracker, tag],
    ).equipment_type,
    "TAG",
  );
});
test("rejects empty, unrelated and ambiguous equipment matches instead of guessing their type", () => {
  assert.throws(
    () => matchEquipment(["9999999"], [tracker, tag]),
    /não corresponde/,
  );
  assert.throws(
    () =>
      matchEquipment(
        [tracker.codigo_serial, tag.codigo_serial],
        [tracker, tag],
      ),
    /mais de um/,
  );
  assert.throws(
    () =>
      matchEquipment(["chip"], [{ codigo_serial: "chip", categoria: "CHIP" }]),
    /não identifica/,
  );
});
test("a blurred/plain photograph returns no barcode", async () => {
  const plain = await sharp({
    create: { width: 500, height: 400, channels: 3, background: "#aab2bc" },
  })
    .jpeg()
    .toBuffer();
  assert.deepEqual(await decodeEquipmentPhoto(plain), []);
});
