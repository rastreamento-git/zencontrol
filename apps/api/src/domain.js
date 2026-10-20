const { fail } = require("./errors");
const statuses = [
  "AGUARDANDO ESTOQUE",
  "CORREÇÃO SOLICITADA",
  "PENDENTE",
  "AGENDADO",
  "EM EXECUÇÃO",
  "AGUARDANDO VALIDAÇÃO",
  "EXECUÇÃO FINALIZADA",
  "AGUARDANDO CONFERÊNCIA",
  "CONCLUÍDO",
  "CANCELADO",
  "REAGENDAR",
];
const services = [
  "Instalação",
  "Manutenção",
  "Retirada",
  "Reinstalação",
  "Improdutiva",
  "Visita",
];
const now = () => new Date().toISOString();
function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
const normalized = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();
const vehicle = (v) => normalized(v).replace(/[^A-Z0-9]/g, "");
function string(v, label = "Campo", max = 1000, required = false) {
  if (
    typeof v !== "string" ||
    v.length > max ||
    v.includes("\0") ||
    (required && !v.trim())
  )
    fail(400, `${label} inválido.`);
  return v.trim();
}
function boolean(v, label) {
  if (typeof v !== "boolean")
    fail(400, `${label} deve ser verdadeiro ou falso.`);
  return v;
}
function date(v, time = false) {
  if (typeof v !== "string" || !v.trim()) return "";
  let s = v.trim();
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s))
    s = s.replace(/^(\d{2})\/(\d{2})\/(\d{4})/, "$3-$2-$1");
  s = s.replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s)) return "";
  const d = new Date(s.length === 10 ? s + "T12:00:00Z" : s + "Z");
  if (
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== s.slice(0, 10)
  )
    return "";
  return time ? s : s.slice(0, 10);
}
function money(v) {
  let s = String(v ?? "0").replace(/R\$|\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    fail(400, "Valor monetário inválido. Use até duas casas decimais.");
  const [whole, fraction = ""] = s.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 1e9)
    fail(400, "Valor monetário fora do limite.");
  return n;
}
function legacyStatus(v) {
  return (
    {
      CONCLUIDO: "CONCLUÍDO",
      AGENDADO: "AGENDADO",
      PENDENTE: "PENDENTE",
      CANCELADO: "CANCELADO",
      REAGENDAR: "REAGENDAR",
    }[normalized(v)] || "PENDENTE"
  );
}
const one = async (db, sql, args = []) =>
  (await db.query(sql, args)).rows[0] || null;
const rows = async (db, sql, args = []) => (await db.query(sql, args)).rows;
async function audit(db, actor, action, type, id, detail = {}) {
  const scope = require("./field-access").context.getStore();
  if (scope?.delegated) {
    actor = scope.actor.nome || scope.actor.login;
    detail = {
      ...detail,
      delegation: {
        actor_user_id: scope.actor.id,
        actor_login: scope.actor.login,
        actor_role: scope.actor.papel,
        technician_id: scope.technician.id,
        technician_name: scope.technician.name,
        origin: "zenfield_supervision",
      },
    };
  }
  await db.query(
    "INSERT INTO zc_audit(created_at,actor,action,entity_type,entity_id,detail) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
    [now(), actor, action, type, String(id), JSON.stringify(detail)],
  );
}
function publicOrder(o) {
  const { raw_legacy, ...rest } = o;
  return rest;
}
module.exports = {
  statuses,
  services,
  now,
  today,
  normalized,
  vehicle,
  string,
  boolean,
  date,
  money,
  legacyStatus,
  one,
  rows,
  audit,
  publicOrder,
};
