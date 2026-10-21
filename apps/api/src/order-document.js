const { fail } = require("./errors");
const d = require("./domain");
const {
  fipeCategories,
  fipeRegions,
} = require("../../../packages/domain/fipe.mjs");
const {
  addressFields,
  brazilStates,
  formatAddress,
  formatPhone,
  phoneDigits,
  displayedService,
  schedulingServices,
} = require("../../../packages/domain/order-fields.mjs");
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
  fipe_region: 10,
  scheduled_service: 30,
  visit_outcome: 30,
  ...Object.fromEntries(
    ["customer", "service"].flatMap((prefix) =>
      addressFields.map(([key, , max]) => [prefix + "_" + key, max]),
    ),
  ),
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
    "vehicle_electric",
    "service_address_same",
    "equipment_counts",
    "reinstallation",
    "reuse_equipment",
  ];
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    fail(
      400,
      "Campo desconhecido nos dados do documento. Serviço, técnico e agendamento vêm da própria OS.",
    );
  const result = { ...previous };
  for (const [key, max] of Object.entries(documentFields))
    if (value[key] !== undefined) result[key] = d.string(value[key], key, max);
  if (
    value.fipe_region !== undefined &&
    result.fipe_region &&
    !fipeRegions.some(([region]) => region === result.fipe_region)
  )
    fail(400, "Regra regional FIPE inválida. Selecione padrão, SP ou RJ.");
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
  if (value.vehicle_electric !== undefined)
    result.vehicle_electric = d.boolean(
      value.vehicle_electric,
      "Veículo elétrico",
    );
  for (const key of [
    "service_address_same",
    "reinstallation",
    "reuse_equipment",
  ])
    if (value[key] !== undefined) result[key] = d.boolean(value[key], key);
  if (
    value.scheduled_service !== undefined &&
    !schedulingServices.includes(result.scheduled_service)
  )
    fail(400, "Selecione Instalação, Manutenção ou Retirada.");
  if (
    value.visit_outcome !== undefined &&
    !["", "unproductive", "reschedule"].includes(result.visit_outcome)
  )
    fail(400, "Sinalização de atendimento inválida.");
  for (const prefix of ["customer", "service"]) {
    const key = prefix + "_state";
    if (result[key]) {
      result[key] = result[key].toUpperCase();
      if (!brazilStates.includes(result[key]))
        fail(400, "Selecione uma UF válida.");
    }
  }
  if (addressFields.some(([key]) => Object.hasOwn(result, "customer_" + key)))
    result.customer_address = formatAddress(result);
  if (value.equipment_counts !== undefined) {
    const counts = value.equipment_counts;
    if (
      !counts ||
      typeof counts !== "object" ||
      Array.isArray(counts) ||
      Object.keys(counts).some((key) => !["tracker", "tag"].includes(key)) ||
      [counts.tracker, counts.tag].some(
        (n) => !Number.isSafeInteger(n) || n < 0 || n > 20,
      ) ||
      counts.tracker + counts.tag > 20
    )
      fail(
        400,
        "Informe as quantidades de rastreadores e TAGs, com até 20 equipamentos no atendimento.",
      );
    result.equipment_counts = { tracker: counts.tracker, tag: counts.tag };
  }
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
  const equipment = data.equipment_counts
    ? Object.entries(data.equipment_counts)
        .filter(([, count]) => count > 0)
        .map(
          ([key, count]) =>
            `${count}x ${key === "tracker" ? "Rastreador" : "TAG"}`,
        )
    : Object.keys(equipmentLabels)
        .filter((k) => (data.equipment || []).includes(k))
        .map((k) => equipmentLabels[k]);
  const instructions = [];
  if (data.vehicle_electric === true)
    instructions.push(
      "VEÍCULO ELÉTRICO: confirme com o cliente a autorização para instalar o rastreador. A indicação de veículo elétrico não autoriza dispensa do equipamento.",
      "",
    );
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
    instructions.push("");
  }
  if (data.reinstallation)
    instructions.push(
      data.reuse_equipment
        ? "REINSTALAÇÃO COM REAPROVEITAMENTO: fotografar as etiquetas dos aparelhos existentes. Não retirar novos equipamentos da carga."
        : "REINSTALAÇÃO SEM REAPROVEITAMENTO: instalar equipamentos da carga do técnico.",
      "",
    );
  if (data.visit_outcome === "unproductive")
    instructions.push(
      "VISITA IMPRODUTIVA: registrar o motivo nas observações. A remuneração segue a tarifa de visita improdutiva.",
      "",
    );
  if (data.visit_outcome === "reschedule")
    instructions.push(
      "REAGENDAMENTO: aguardar a confirmação de uma nova data pela central.",
      "",
    );
  instructions.push(order.notes || "Sem observações adicionais.");
  const controlled = order.workflow_mode === "controlled";
  return {
    id: order.id,
    masked,
    draft: !order.technician_id || !order.scheduled_at,
    customer: {
      name: masked ? maskedName(order.customer_name) : order.customer_name,
      contact: [10, 11].includes(phoneDigits(order.contact).length)
        ? formatPhone(order.contact)
        : order.contact,
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
      type:
        data.vehicle_type ||
        (fipeCategories.includes(order.fipe_risk) ? "" : order.fipe_risk),
      category: data.category,
      fipe: order.fipe_value,
      fipe_type: fipeCategories.includes(order.fipe_risk)
        ? order.fipe_risk
        : "",
      fipe_region:
        order.fipe_risk === "Alta"
          ? "Todas as UFs"
          : fipeRegions.find(([region]) => region === data.fipe_region)?.[1] ||
            "",
      electric: data.vehicle_electric === true,
    },
    // Intentionally no editable overrides: these three values come from the OS.
    service: displayedService(order),
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
    fipe_risk: "",
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
      customer_street: scalar(v.logradouro),
      customer_number: scalar(v.numero),
      customer_block: scalar(v.bloco),
      customer_complement: scalar(v.complemento),
      customer_neighborhood: scalar(v.bairro),
      customer_city: scalar(v.cidade, v.municipio),
      customer_state: scalar(v.estado, v.uf).toUpperCase(),
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
