class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
function integer(value, label, min = 1) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    String(value).trim() === ""
  )
    fail(400, `${label} inválido.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > 2147483647)
    fail(400, `${label} inválido.`);
  return number;
}
function text(value, label, max = 120) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    fail(400, `${label} inválido.`);
  return value.trim();
}
function serials(value) {
  if (!Array.isArray(value) || !value.length || value.length > 1000)
    fail(400, "Informe entre 1 e 1000 IMEIs/seriais por operação.");
  const list = value.map((v) => text(v, "IMEI/serial", 128));
  if (new Set(list).size !== list.length)
    fail(400, "O lote contém IMEIs/seriais repetidos.");
  return list;
}
module.exports = { HttpError, fail, integer, text, serials };
