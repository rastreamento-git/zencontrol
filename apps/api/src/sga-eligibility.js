const { createHmac, timingSafeEqual } = require("node:crypto");
const d = require("./domain");
const { fail } = require("./errors");
const normalize = (v) => d.normalized(v || "").replace(/[^A-Z0-9]/g, "");
const blocked = /INADIMPL|INATIV|CANCELAD|SUSPENS|BLOQUEAD|EXCLUID|DESLIGAD/;
function evaluate(state = {}) {
  const values = [
    state.vehicle_status,
    state.vehicle_classification,
    state.customer_status,
    state.customer_classification,
    state.financial_status,
  ];
  const reasons = values
    .filter((v) => blocked.test(normalize(v)))
    .map((v) => "Restrição SGA: " + v);
  const active = (v) => ["ATIVO", "ATIVA", "REGULAR"].includes(normalize(v));
  if (!active(state.vehicle_status))
    reasons.push("Situação do veículo não liberada ou não confirmada");
  if (!active(state.customer_status))
    reasons.push("Situação do associado não liberada ou não confirmada");
  if (
    !["ADIMPLENTE", "REGULAR", "EMDIA"].includes(
      normalize(state.financial_status),
    )
  )
    reasons.push("Regularidade financeira não confirmada");
  return {
    ...state,
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
  };
}
function snapshot(data) {
  return {
    vehicle: d.vehicle(data.vehicle),
    chassis: d.vehicle(data.chassis),
    customer_name: data.customer_name || "",
    sga_id: data.sga_id || "",
    verified_at: data.sga_assessment?.checked_at || d.now(),
    assessment: evaluate(data.sga_assessment),
  };
}
function sign(check, secret) {
  const encoded = Buffer.from(JSON.stringify(check)).toString("base64url");
  return (
    encoded +
    "." +
    createHmac("sha256", secret).update(encoded).digest("base64url")
  );
}
function read(token, secret) {
  if (typeof token !== "string" || token.length > 16000)
    fail(400, "Validação SGA inválida. Consulte novamente.");
  const [data, mac, ...extra] = token.split(".");
  const expected = createHmac("sha256", secret)
    .update(data || "")
    .digest();
  const received = Buffer.from(mac || "", "base64url");
  if (
    extra.length ||
    received.length !== expected.length ||
    !timingSafeEqual(expected, received)
  )
    fail(400, "Validação SGA inválida. Consulte novamente.");
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    fail(400, "Validação SGA inválida.");
  }
}
function usable(check, order) {
  return !!(
    check?.verified_at &&
    Date.now() - new Date(check.verified_at).getTime() >= 0 &&
    Date.now() - new Date(check.verified_at).getTime() < 15 * 60 * 1000 &&
    [check.vehicle, check.chassis].includes(d.vehicle(order.vehicle)) &&
    normalize(check.customer_name) === normalize(order.customer_name)
  );
}
function assertEligible(check, order) {
  if (!usable(check, order))
    fail(
      409,
      "Consulte e complete o cadastro SGA desta OS antes de agendar. A validação deve ser atual e corresponder ao veículo e associado.",
    );
  const assessment = evaluate(check.assessment);
  if (!assessment.eligible)
    fail(
      409,
      "Agendamento bloqueado. " +
        assessment.reasons.join("; ") +
        ". Regularize o cadastro e consulte novamente.",
    );
  return check;
}
module.exports = { evaluate, snapshot, sign, read, usable, assertEligible };
