const { fail } = require("./errors");
const isInstallation = (service) =>
  ["Instalação", "Reinstalação"].some((s) => service?.startsWith(s));
const bundled = (order) => !!order.document_data?.equipment_counts;
const reused = (order) =>
  order.document_data?.reinstallation === true &&
  order.document_data?.reuse_equipment === true;
function requiredEquipment(order) {
  if (order.tracker_waiver_authorized || !isInstallation(order.service))
    return { RASTREADOR: 0, TAG: 0 };
  if (bundled(order))
    return {
      RASTREADOR: order.document_data.equipment_counts.tracker,
      TAG: order.document_data.equipment_counts.tag,
    };
  const selected = order.document_data?.equipment?.length
    ? order.document_data.equipment
    : ["tracker"];
  return {
    RASTREADOR:
      Number(selected.includes("tracker")) +
      Number(selected.includes("tracker_extra")),
    TAG: Number(selected.includes("tag")),
  };
}
function prepareEquipment(data, input, old = null) {
  const service = data.service ?? old?.service;
  const document = data.document_data
    ? JSON.parse(data.document_data)
    : { ...old?.document_data };
  if (
    !old &&
    !input.additional &&
    !input.document_data?.equipment &&
    !document.equipment_counts
  )
    document.equipment_counts = {
      tracker: isInstallation(service) ? 1 : 0,
      tag: 0,
    };
  if (
    old?.document_data?.equipment_counts &&
    input.document_data?.equipment &&
    !input.document_data.equipment_counts
  ) {
    const selected = input.document_data.equipment;
    document.equipment_counts = {
      tracker:
        Number(selected.includes("tracker")) +
        Number(selected.includes("tracker_extra")),
      tag: Number(selected.includes("tag")),
    };
    if (
      selected.includes("tracker_extra") &&
      !selected.includes("tracker") &&
      !selected.includes("tag")
    )
      document.equipment_counts.tracker++;
  }
  if (document.equipment_counts && input.additional) {
    if (!["Tag Extra", "Rastreador Extra"].includes(input.additional))
      fail(400, "Equipamento adicional inválido.");
    const key = input.additional === "Tag Extra" ? "tag" : "tracker";
    const primary = document.equipment_counts.tracker > 0 ? "tracker" : "tag";
    document.equipment_counts[key] = Math.max(
      document.equipment_counts[key],
      Number(primary === key) + 1,
    );
  }
  if (document.equipment_counts) {
    const counts = document.equipment_counts;
    if (counts.tracker + counts.tag > 20)
      fail(400, "Limite de 20 equipamentos por atendimento.");
    if (old?.parent_order_id) {
      const key = old.additional_equipment === "TAG" ? "tag" : "tracker";
      if (
        counts[key] !== 1 ||
        counts.tracker + counts.tag !== 1 ||
        input.additional
      )
        fail(
          400,
          "A quantidade do equipamento adicional é definida pela OS principal.",
        );
    }
    const types = [
      ...Array(counts.tracker).fill("RASTREADOR"),
      ...Array(counts.tag).fill("TAG"),
    ];
    const waived =
      data.tracker_waiver_authorized ?? old?.tracker_waiver_authorized;
    if (isInstallation(service) && !waived && !types.length)
      fail(400, "Informe ao menos um rastreador ou TAG para instalar.");
    document.equipment = types.length
      ? [types[0] === "TAG" ? "tag" : "tracker"]
      : [];
    data.document_data = JSON.stringify(document);
    return isInstallation(service) &&
      !waived &&
      document.visit_outcome !== "reschedule"
      ? types.slice(1)
      : [];
  }
  const requested = new Set();
  if (input.additional) {
    if (!["Tag Extra", "Rastreador Extra"].includes(input.additional))
      fail(400, "Equipamento adicional inválido.");
    requested.add(input.additional === "Tag Extra" ? "TAG" : "RASTREADOR");
  }
  if (old?.parent_order_id) {
    if (requested.size)
      fail(
        400,
        "Abra a OS principal para solicitar outro equipamento adicional.",
      );
    if (!isInstallation(service))
      fail(
        400,
        "A OS de equipamento adicional precisa manter um serviço de instalação.",
      );
    const expected = old.additional_equipment === "TAG" ? "tag" : "tracker";
    const incoming = input.document_data?.equipment?.map((k) =>
      k === "tracker_extra" ? "tracker" : k,
    );
    if (incoming && (incoming.length !== 1 || !incoming.includes(expected)))
      fail(
        400,
        "O tipo do equipamento adicional é definido pela OS de origem.",
      );
    document.equipment = [expected];
  } else if (document.equipment?.includes("tracker_extra")) {
    requested.add("RASTREADOR");
    document.equipment = document.equipment.filter(
      (k) => k !== "tracker_extra",
    );
  }
  const waived =
    data.tracker_waiver_authorized ?? old?.tracker_waiver_authorized;
  if (
    requested.size &&
    (!isInstallation(service) ||
      waived ||
      (data.status ?? old?.status) === "CANCELADO")
  )
    fail(
      400,
      "Equipamento adicional exige uma OS ativa de instalação, sem dispensa de rastreador.",
    );
  if (isInstallation(service) && !waived) {
    document.equipment ??= ["tracker"];
    if (!document.equipment.length)
      fail(
        400,
        "Selecione o rastreador ou a TAG da OS principal antes de adicionar um equipamento extra.",
      );
  }
  data.document_data = JSON.stringify(document);
  return [...requested];
}
module.exports = {
  isInstallation,
  requiredEquipment,
  prepareEquipment,
  bundled,
  reused,
};
