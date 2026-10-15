export const BARCODE_FORMATS = [
  "Code128",
  "Code39",
  "Code93",
  "EAN13",
  "EAN8",
  "UPCA",
  "UPCE",
  "ITF",
  "Codabar",
];
export function readerOptions(mode = "auto") {
  return {
    formats:
      mode === "qr"
        ? ["QRCode"]
        : mode === "barcode"
          ? BARCODE_FORMATS
          : ["QRCode", ...BARCODE_FORMATS],
    // Keep broad scan-line sampling even on fast frames. Disabling this
    // makes off-center linear codes harder to find.
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    minLineCount: 3,
    maxNumberOfSymbols: 4,
    returnErrors: false,
    textMode: "Plain",
  };
}

// Modes limit formats, never the position of a label. Every edge is decoded.
export function scanRegion(width, height) {
  return { x: 0, y: 0, width, height };
}

export function frameSize(width, height, profile = "fast") {
  const scale =
    profile === "fast" ? Math.min(1, 1280 / Math.max(width, height)) : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function validResults(results) {
  const unique = new Map();
  for (const result of results) {
    if (!result.isValid || result.error || typeof result.text !== "string")
      continue;
    const code = result.text.trim();
    // eslint-disable-next-line no-control-regex
    if (!code || code.length > 128 || /[\x00-\x1f\x7f]/.test(result.text))
      continue;
    if (!unique.has(code)) unique.set(code, { ...result, text: code });
  }
  return [...unique.values()];
}

export async function decodePixels(image, mode, read, profile = "accurate") {
  const options = readerOptions(mode);
  const results = validResults(await read(image, options));
  if (results.length || profile === "fast") return results;
  // ZXing's tryInvert only covers some symbologies. Explicit inversion also
  // supports light bars on dark labels without modifying the source pixels.
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  const inverted = { data, width: image.width, height: image.height };
  return validResults(await read(inverted, options));
}

const checksummedFormats = new Set([
  "QRCode",
  "Code128",
  "Code93",
  "EAN13",
  "EAN8",
  "UPCA",
  "UPCE",
]);
export function confirmationsFor(format) {
  return checksummedFormats.has(format) ? 2 : 3;
}

// Checksummed codes need two fresh frames; non-checksummed codes still need
// three. One brief missed frame does not discard a correct candidate.
export function confirmationGate({
  required,
  windowMs = 5000,
  missGraceMs = 450,
} = {}) {
  let candidate = null;
  return {
    reset() {
      candidate = null;
    },
    observe(results, now) {
      const codes = validResults(results);
      if (codes.length > 1) {
        candidate = null;
        return { ambiguous: true };
      }
      if (!codes.length) {
        if (candidate && now - candidate.lastSeen > missGraceMs)
          candidate = null;
        return {};
      }
      const result = codes[0];
      const key = `${result.format}:${result.text}`;
      if (
        !candidate ||
        candidate.key !== key ||
        now - candidate.started > windowMs
      )
        candidate = { key, count: 0, started: now, lastSeen: now };
      candidate.count++;
      candidate.lastSeen = now;
      const needed = required ?? confirmationsFor(result.format);
      return candidate.count >= needed
        ? { result, required: needed }
        : { count: candidate.count, required: needed };
    },
  };
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}
export function cameraConstraints(device = "") {
  return {
    audio: false,
    video: {
      ...(device
        ? { deviceId: { exact: device } }
        : { facingMode: { ideal: "environment" } }),
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30, max: 30 },
    },
  };
}
export async function tuneCamera(track) {
  const capabilities = track.getCapabilities?.() || {};
  // Optional settings must never prevent opening fixed-focus cameras.
  for (const name of ["focusMode", "exposureMode", "whiteBalanceMode"]) {
    if (capabilities[name]?.includes("continuous")) {
      try {
        await track.applyConstraints({ advanced: [{ [name]: "continuous" }] });
      } catch {
        /* Some browsers advertise unsupported optional controls. */
      }
    }
  }
  return capabilities;
}
export function cameraError(error) {
  const name = error?.name || String(error);
  if (/NotAllowed|Permission|denied/i.test(name))
    return "Permissão negada. Libere a câmera nas configurações deste site e tente novamente.";
  if (/NotFound|DevicesNotFound/i.test(name))
    return "Nenhuma câmera encontrada. Conecte uma câmera ou importe uma foto.";
  if (/NotReadable|TrackStart/i.test(name))
    return "A câmera está ocupada ou indisponível. Feche os outros aplicativos que a utilizam.";
  if (/Overconstrained|ConstraintNotSatisfied/i.test(name))
    return "Essa câmera não está disponível. Selecione outra câmera e tente novamente.";
  return "Não foi possível abrir o leitor. Confira a conexão, as permissões e tente novamente ou importe uma foto.";
}
