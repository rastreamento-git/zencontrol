const sharp = require("sharp");
const { createHash } = require("node:crypto");
const { fail } = require("./errors");
const { createMediaStore } = require("./media-store");
async function expenseReceipt(cfg, image) {
  const match =
    typeof image === "string" &&
    image.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match)
    fail(400, "Anexe uma foto do comprovante da despesa (JPEG, PNG ou WebP).");
  const input = Buffer.from(match[1], "base64");
  if (!input.length || input.length > 4 * 1024 * 1024)
    fail(400, "A foto do comprovante deve ter até 4 MB.");
  let bytes;
  try {
    const image = sharp(input, { limitInputPixels: 24000000, animated: false });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format) || (meta.pages || 1) > 1)
      throw Error("format");
    bytes = await image
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    fail(400, "A foto do comprovante está inválida. Envie uma imagem legível.");
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  const receipt = { path: sha + ".jpg", mime: "image/jpeg", sha };
  await createMediaStore(cfg).put(receipt.path, bytes);
  return receipt;
}
module.exports = { expenseReceipt };
