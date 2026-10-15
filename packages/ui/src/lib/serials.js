export const MAX_BATCH = 1000;
export function normalizeSerials(values) {
  const list = values.map((value) => String(value).trim()).filter(Boolean);
  // Control characters cannot be stored or scanned as serial identifiers.
  // eslint-disable-next-line no-control-regex
  if (list.some((code) => code.length > 128 || /[\x00-\x1f\x7f]/.test(code)))
    throw new Error(
      "Serial inválido: máximo de 128 caracteres, sem caracteres de controle.",
    );
  return [...new Set(list)];
}
export function mergeSerials(current, incoming) {
  const next = [...new Set([...normalizeSerials(incoming), ...current])];
  if (next.length > MAX_BATCH)
    throw new Error(`Cada lote pode ter no máximo ${MAX_BATCH} seriais.`);
  return next;
}
