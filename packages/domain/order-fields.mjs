export const schedulingServices = ["Instalação", "Manutenção", "Retirada"];
export const brazilStates = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];
export const addressFields = [
  ["street", "Logradouro", 240],
  ["number", "Número", 30],
  ["block", "Bloco", 60],
  ["complement", "Complemento", 160],
  ["neighborhood", "Bairro", 120],
  ["city", "Município", 120],
  ["state", "Estado", 2],
];
export function phoneDigits(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if ([12, 13].includes(digits.length) && digits.startsWith("55"))
    digits = digits.slice(2);
  return digits;
}
export function formatPhone(value) {
  const digits = phoneDigits(value).slice(0, 11);
  if (!digits) return "";
  if (digits.length < 3) return "(" + digits;
  const local = digits.slice(2),
    split = local.length > 8 ? 5 : 4;
  return `(${digits.slice(0, 2)})${local.slice(0, split)}${local.length > split ? "-" + local.slice(split) : ""}`;
}
export function formatAddress(data, prefix = "customer") {
  const value = (key) => String(data?.[`${prefix}_${key}`] || "").trim();
  const first = [value("street"), value("number")].filter(Boolean).join(", ");
  const complement = [
    value("block") && "Bloco " + value("block"),
    value("complement"),
  ]
    .filter(Boolean)
    .join(" · ");
  return [
    first,
    complement,
    value("neighborhood"),
    [value("city"), value("state")].filter(Boolean).join(" / "),
  ]
    .filter(Boolean)
    .join(" - ");
}
export function scheduledService(order) {
  return (
    order?.document_data?.scheduled_service ||
    (order?.service?.startsWith("Reinstalação")
      ? "Instalação"
      : schedulingServices.find((s) => order?.service?.startsWith(s))) ||
    "Instalação"
  );
}
export function displayedService(order) {
  const data = order.document_data || {};
  if (data.visit_outcome === "unproductive")
    return `${scheduledService(order)} - Visita improdutiva`;
  if (data.visit_outcome === "reschedule")
    return `${scheduledService(order)} - Reagendamento`;
  return order.service;
}
