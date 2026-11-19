const d = require("./domain");
const norm = (v) => d.normalized(v).replace(/\s+/g, " ");
const names = [
  "JANEIRO",
  "FEVEREIRO",
  "MARCO",
  "ABRIL",
  "MAIO",
  "JUNHO",
  "JULHO",
  "AGOSTO",
  "SETEMBRO",
  "OUTUBRO",
  "NOVEMBRO",
  "DEZEMBRO",
];
function period(name) {
  const m = norm(name).match(/^([A-Z]+)[\s/_.-]+(\d{4})$/);
  if (!m || !names.includes(m[1]) || Number(m[2]) < 2000 || Number(m[2]) > 2199)
    return null;
  return `${m[2]}-${String(names.indexOf(m[1]) + 1).padStart(2, "0")}`;
}
const aliases = [
  [],
  ["SERVICO", "SERVICOS", "TIPO DE SERVICO"],
  ["NOME DO ASSOCIADO", "ASSOCIADO", "CLIENTE"],
  ["PLACA / CHASSI", "PLACA/CHASSI", "PLACA", "CHASSI"],
  ["IMEI", "IMEI / TAG", "IMEI/TAG"],
  ["DATA DE ENVIO DO TERMO", "ENVIO DO TERMO", "TERMO"],
  ["DATA DE CONCLUSAO", "CONCLUSAO"],
  ["TECNICO", "TECNICO / EMPRESA"],
  ["REGIAO"],
  ["VOLUNTARIO"],
  ["VALOR FIPE"],
  ["FIPE", "CLASSIFICACAO FIPE"],
  ["INCLUIU"],
  ["CONCLUIU"],
  ["SITUACAO", "STATUS"],
];
function structure(sheet, value) {
  for (let n = 1; n <= Math.min(sheet.rowCount, 30); n++) {
    const header = sheet.getRow(n);
    const labels = Array.from(
      { length: Math.min(sheet.columnCount, 64) },
      (_, i) => norm(value(header.getCell(i + 1))),
    );
    const columns = aliases.map((a) => {
      const matches = labels.flatMap((s, i) => (a.includes(s) ? [i + 1] : []));
      return matches.length === 1 ? matches[0] : 0;
    });
    if (!columns[1] || !columns[2] || !columns[3]) continue;
    const original =
      columns[1] === 2 &&
      columns[2] === 3 &&
      columns[3] === 4 &&
      columns[14] === 15;
    if (original && !labels[13]) columns[13] = 14;
    const notes = labels.flatMap((s, i) =>
      /^OBSERVAC/.test(s) ? [i + 1] : [],
    );
    if (original) {
      for (let c = 16; c <= 20; c++) if (!notes.includes(c)) notes.push(c);
    }
    return {
      headerRow: n,
      columns,
      notes,
      original,
      scheduled:
        labels.findIndex((s) =>
          ["DATA DE AGENDAMENTO", "AGENDAMENTO", "DATA AGENDADA"].includes(s),
        ) + 1,
      shift:
        labels.findIndex((s) => ["TURNO", "PERIODO DO DIA"].includes(s)) + 1,
    };
  }
  return null;
}
function parseDate(v, month) {
  if (!v || v === "-") return "";
  let s = v;
  if (/^\d{2}\/\d{2}$/.test(s)) s += "/" + month.slice(0, 4);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) s = s.split("/").reverse().join("-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const dt = new Date(s + "T00:00:00Z");
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === s
    ? s
    : null;
}
function infer({ status, completed, scheduled, month, today = d.today() }) {
  const source = norm(status),
    issues = [],
    reasons = [];
  const mapped = Object.fromEntries(d.statuses.map((s) => [norm(s), s]));
  Object.assign(mapped, {
    "CANCELADO EM SISTEMA": "CANCELADO",
    REAGENDAMENTO: "REAGENDAR",
  });
  let stage = mapped[source];
  if (source && !stage)
    issues.push(
      "Situação administrativa exige revisão; não comprova etapa do serviço",
    );
  if (!source) {
    stage = completed ? "CONCLUÍDO" : scheduled ? "AGENDADO" : "PENDENTE";
    reasons.push(
      completed
        ? "Data de conclusão preenchida"
        : scheduled
          ? "Data de agendamento identificada"
          : "Sem conclusão ou agendamento: atendimento pendente",
    );
  } else reasons.push(`Situação informada: ${status}`);
  stage ||= "PENDENTE";

  if (completed && stage !== "CONCLUÍDO")
    issues.push("Data de conclusão conflita com a situação informada");
  if (completed && completed > today) issues.push("Conclusão no futuro");
  if (["AGENDADO", "EM EXECUÇÃO"].includes(stage) && !scheduled)
    issues.push("Etapa exige data de agendamento");
  if (
    [
      "AGUARDANDO ESTOQUE",
      "AGUARDANDO VALIDAÇÃO",
      "EXECUÇÃO FINALIZADA",
      "AGUARDANDO CONFERÊNCIA",
      "CORREÇÃO SOLICITADA",
    ].includes(stage)
  )
    issues.push(
      "Etapa exige evidências e conferência do fluxo integrado; revisar antes de migrar",
    );
  const terminal = ["CONCLUÍDO", "CANCELADO"].includes(stage);
  const archive = "";
  reasons.push("Base de destino será escolhida pelo administrador");
  if (scheduled && scheduled < today && !terminal)
    reasons.push(
      "Agendamento vencido; atraso não significa conclusão ou cancelamento",
    );
  return {
    status: stage,
    archive,
    workflow_mode: terminal ? "legacy" : "controlled",
    issues,
    reasons,
    terminal,
  };
}
module.exports = { period, structure, parseDate, infer };
