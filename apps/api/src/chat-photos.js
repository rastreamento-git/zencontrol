const { createHash, randomUUID } = require("node:crypto");
const sharp = require("sharp");
const { fail } = require("./errors");

const chatPhotoVersion = 1;
const photoMessageType = "application/vnd.zencontrol.chat+json";
const maxChatPhotos = 4;
const maxBytes = 1024 * 1024;
const maxDataLength = 32 + Math.ceil(maxBytes / 3) * 4;
const dataUrl = /^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/]+={0,2})$/;

function decodePhotos(value = []) {
  if (!Array.isArray(value) || value.length > maxChatPhotos)
    fail(400, "Envie até quatro fotos por mensagem.");
  return value.map((photo) => {
    if (typeof photo !== "string")
      fail(400, "Escolha uma foto JPEG, PNG ou WebP.");
    if (photo.length > maxDataLength)
      fail(413, "Uma foto excede o limite de envio.");
    const match = dataUrl.exec(photo);
    if (!match || match[2].length % 4 !== 0)
      fail(400, "Escolha uma foto JPEG, PNG ou WebP.");
    const input = Buffer.from(match[2], "base64");
    if (input.length > maxBytes)
      fail(413, "Uma foto excede o limite de envio.");
    return {
      input,
      format: match[1],
      source_sha256: createHash("sha256").update(input).digest("hex"),
    };
  });
}

async function preparePhotos(photos) {
  const prepared = [];
  for (const photo of photos) {
    try {
      const image = sharp(photo.input, { limitInputPixels: 16000000 });
      const metadata = await image.metadata();
      if (metadata.format !== photo.format || metadata.pages > 1)
        throw Error("invalid image");
      const bytes = await image
        .rotate()
        .resize({
          width: 1800,
          height: 1800,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 86 })
        .toBuffer();
      prepared.push({
        reference: {
          path: randomUUID() + ".jpg",
          source_sha256: photo.source_sha256,
        },
        bytes,
      });
    } catch {
      fail(
        400,
        "Não foi possível abrir a foto. Escolha uma imagem JPEG, PNG ou WebP válida.",
      );
    }
  }
  return prepared;
}

function validPhotoReference(photo) {
  return (
    typeof photo?.path === "string" &&
    /^[-a-f0-9]+\.jpg$/.test(photo.path) &&
    typeof photo.source_sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(photo.source_sha256)
  );
}

module.exports = {
  chatPhotoVersion,
  photoMessageType,
  maxChatPhotos,
  decodePhotos,
  preparePhotos,
  validPhotoReference,
};
