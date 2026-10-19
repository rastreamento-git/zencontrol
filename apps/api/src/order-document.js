const { fail } = require("./errors");
const d = require("./domain");
const documentFields = {
  cpf_cnpj: 30,
  rg: 30,
  customer_address: 700,
  plate: 40,
  renavam: 30,
  brand: 120,
  model: 240,
  year: 30,
  vehicle_type: 120,
  category: 120,
};
const equipmentLabels = {
  tracker: "1x Rastreador",
  tracker_extra: "1x Rastreador Extra",
  tag: "1x Tag",
};
function normalizeDocumentData(value, previous = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "Dados do documento devem ser um objeto.");
  const allowed = [
    ...Object.keys(documentFields),
    "equipment",
    "technician_brings_equipment",
  ];
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    fail(
      400,
      "Campo desconhecido nos dados do documento. Serviço, técnico e agendamento vêm da própria OS.",
    );
  const result = { ...previous };
  for (const [key, max] of Object.entries(documentFields))
    if (value[key] !== undefined) result[key] = d.string(value[key], key, max);
  if (value.equipment !== undefined) {
    if (
      !Array.isArray(value.equipment) ||
      value.equipment.length > 3 ||
      value.equipment.some((v) => !Object.hasOwn(equipmentLabels, v))
    )
      fail(400, "Seleção de equipamentos inválida.");
    result.equipment = Object.keys(equipmentLabels).filter((k) =>
      value.equipment.includes(k),
    );
  }
  if (value.technician_brings_equipment !== undefined)
    result.technician_brings_equipment = d.boolean(
      value.technician_brings_equipment,
      "Levar equipamentos",
    );
  return result;
}
function appointment(value) {
  if (!value) return "A combinar";
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime()))
      return new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
        .format(date)
        .replace(", ", " às ");
  }
  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}))?/,
  );
  return match
    ? `${match[3]}/${match[2]}/${match[1]}${match[4] ? " às " + match[4] : ""}`
    : String(value);
}
function maskedName(value) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length > 2
    ? parts.slice(0, 2).join(" ") + " ***"
    : parts.join(" ");
}
function hidden(value, kind, masked) {
  if (!value) return "";
  if (!masked) return value;
  if (kind === "cpf_cnpj")
    return String(value).replace(/\D/g, "").length === 14
      ? "**.***.***/****-**"
      : "***.***.***-**";
  return "***";
}
function orderDocument(order, masked = true, { portalUrl = "" } = {}) {
  const data = order.document_data || {};
  const equipment = Object.keys(equipmentLabels)
    .filter((k) => (data.equipment || []).includes(k))
    .map((k) => equipmentLabels[k]);
  const instructions = [];
  if (order.tracker_waiver_authorized) {
    instructions.push(
      "DISPENSA DE RASTREADOR AUTORIZADA: cliente autorizado a permanecer sem rastreador. Esta OS não integra a remuneração do técnico, inclusive adicionais e ajustes.",
      "",
    );
  }
  if (equipment.length && !order.tracker_waiver_authorized) {
    instructions.push(
      "EQUIPAMENTOS SELECIONADOS: " + equipment.join(" | ") + ".",
    );
    instructions.push(
      data.technician_brings_equipment !== false
        ? "STATUS: O técnico DEVERÁ LEVAR os equipamentos para o local."
        : "STATUS: O técnico NÃO levará os equipamentos (já se encontram com o cliente).",
    );
    instructions.push("");
  }
  instructions.push(order.notes || "Sem observações adicionais.");
  const controlled = order.workflow_mode === "controlled";
  return {
    id: order.id,
    masked,
    draft: !order.technician_id || !order.scheduled_at,
    customer: {
      name: masked ? maskedName(order.customer_name) : order.customer_name,
      contact: order.contact,
      document: hidden(data.cpf_cnpj, "cpf_cnpj", masked),
      rg: hidden(data.rg, "rg", masked),
      address: data.customer_address,
    },
    vehicle: {
      plate: /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(d.vehicle(order.vehicle))
        ? d.vehicle(order.vehicle)
        : data.plate || "",
      chassis:
        order.chassis ||
        (d.vehicle(order.vehicle).length > 10 ? order.vehicle : ""),
      renavam: hidden(data.renavam, "renavam", masked),
      brand: data.brand,
      model: data.model,
      year: data.year,
      type: data.vehicle_type || order.fipe_risk,
      category: data.category,
      fipe: order.fipe_value,
    },
    // Intentionally no editable overrides: these three values come from the OS.
    service: order.service,
    technician: order.technician_name || "NÃO ATRIBUÍDO",
    appointment: appointment(order.scheduled_at),
    location: order.location,
    instructions: instructions.join("\n"),
    returnInstructions: order.tracker_waiver_authorized
      ? "Registre as fotos da vistoria e o checklist preenchido e assinado no portal do técnico. Envie para conferência da central. A dispensa não registra instalação no Estoque Pro e não gera remuneração."
      : controlled
        ? `Registre as fotos e os IMEIs/seriais no portal do técnico${portalUrl ? ": " + portalUrl : ""}. Envie para a conferência da central. A conclusão depende da aprovação no ZenControl e, nas instalações, da confirmação do Estoque Pro.`
        : `Encaminhe OS: ${order.id}, Placa ou Chassi: ${order.vehicle}, as fotos e os comentários. Finalize com . ou #.# para o hub.`,
  };
}
function scalar(...values) {
  const v = values.find(
    (v) => (typeof v === "string" || typeof v === "number") && String(v).trim(),
  );
  return v === undefined ? "" : String(v).trim();
}
function money(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(raw))
    return Number(raw).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  return raw;
}
const sgaClassifications = {
  1: "Concluído",
  4: "Falta pagar 1º boleto",
  5: "Falta pagar 2º boleto",
  6: "1º boleto pago e s/ rastreador",
  7: "Falta pagar 1º boleto - mg",
  8: "1º e 2º pago e s/ rastreador",
  9: "Moto abaixo de 8mil",
  10: "Falta vistoria",
  11: "Migração",
  12: "Sem rastreador",
  13: "Com rastreador",
  14: "Instalação pendente",
  15: "Aguardando taxa instalação",
  16: "Carnê",
  17: "Faltando vistoria, sem rastreador",
  18: "Pendente",
  19: "Aguardando indenização",
  20: "Roubo/furto",
  21: "Instalação agendada",
};
const sgaStatuses = {
  1: "Ativo",
  2: "Inativo",
  3: "Pendente",
  4: "Inadimplente",
  5: "Negado",
  6: "Cancelado",
  7: "Evento",
  8: "Indenizado",
  9: "Pré-aprovado",
  10: "Evento negado",
  11: "Cancelado com rastreador",
  12: "Inativos com rastreador",
  13: "Inativos sem rastreador",
  14: "Ativo com adesivo",
  15: "Publicado no spc/serasa",
  16: "Aguardando taxa instalação",
  17: "Cancelamento pendente",
  18: "Envio de termos",
  19: "Desligado do corpo associativo",
  22: "Aguardando indenização",
};
function displaySga(code, description, labels) {
  const key = /^\d+$/.test(code) ? String(Number(code)) : code;
  return (
    labels[key] || description || (key && key !== "0" ? "Cód: " + key : "")
  );
}
function mapSgaVehicle(v) {
  const address = ["logradouro", "numero", "bairro", "cidade", "estado", "cep"]
    .map((k) => scalar(v[k]))
    .filter(Boolean)
    .join(", ");
  const classification = scalar(
    v.classificacao_real,
    v.descricao_classificacao,
    v.classificacao,
  );
  const status = scalar(
    v.situacao_real,
    v.descricao_situacao,
    v.situacao_veiculo,
    v.situacao,
  );
  return {
    vehicle: scalar(v.placa, v.chassi),
    chassis: scalar(v.chassi),
    sga_id: scalar(v.codigo_veiculo),
    customer_name: scalar(v.nome),
    contact:
      scalar(v.ddd_celular, v.ddd) + scalar(v.telefone_celular, v.telefone),
    volunteer: scalar(v.voluntario_real, v.nome_voluntario, v.nome_usuario),
    fipe_value: money(scalar(v.valor_fipe, v.fipe_valor, v.valor_mercado)),
    fipe_risk: scalar(v.tipo, v.descricao_tipo_veiculo),
    sga_classification: displaySga(
      scalar(
        v.codigo_classificacao,
        v.codigo_classificacao_veiculo,
        v.id_classificacao,
      ),
      classification,
      sgaClassifications,
    ),
    sga_status: displaySga(
      scalar(v.codigo_situacao_veiculo, v.codigo_situacao),
      status,
      sgaStatuses,
    ),
    location: address,
    document_data: {
      cpf_cnpj: scalar(v.cpf, v.cnpj, v.cpf_cnpj),
      rg: scalar(v.rg),
      customer_address: address,
      plate: scalar(v.placa),
      renavam: scalar(v.renavam),
      brand: scalar(v.marca, v.descricao_marca),
      model: scalar(v.modelo, v.descricao_modelo),
      year: [scalar(v.ano_fabricacao), scalar(v.ano_modelo)]
        .filter(Boolean)
        .join("/"),
      vehicle_type: scalar(v.tipo, v.descricao_tipo_veiculo),
      category: scalar(v.categoria, v.descricao_categoria),
    },
  };
}
module.exports = {
  documentFields,
  equipmentLabels,
  normalizeDocumentData,
  orderDocument,
  appointment,
  mapSgaVehicle,
};
