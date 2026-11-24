const path = require("node:path"),
  fs = require("node:fs/promises");
const { photo } = require("../apps/api/test/helpers/equipment-photo.cjs");
const { PDFDocument } = require("pdf-lib"),
  sharp = require("sharp");
async function generate(fixtures) {
  await fs.mkdir(fixtures, { recursive: true });
  for (const [name, code, format] of [
    ["rastreador-jose", "123456789012345", "Code128"],
    ["tag-jose", "TAG-HOMO-001", "QRCode"],
    ["rastreador-maria", "123456789012346", "Code128"],
    ["tag-maria", "TAG-HOMO-002", "QRCode"],
  ])
    await fs.writeFile(
      path.join(fixtures, name + ".jpg"),
      Buffer.from((await photo(code, format)).split(",")[1], "base64"),
    );
  await fs.writeFile(
    path.join(fixtures, "foto-vistoria-exemplo.jpg"),
    await sharp({
      create: { width: 900, height: 600, channels: 3, background: "#d3dfed" },
    })
      .jpeg()
      .toBuffer(),
  );
  const pdf = await PDFDocument.create();
  pdf
    .addPage()
    .drawText(
      "CHECKLIST FICTICIO - homologacao local - assinatura de demonstracao",
    );
  await fs.writeFile(
    path.join(fixtures, "checklist-ficticio.pdf"),
    await pdf.save(),
  );
}
module.exports = { generate };
