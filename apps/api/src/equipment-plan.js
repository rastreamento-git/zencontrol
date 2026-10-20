const { fail } = require("./errors");
const isInstallation = (service) =>
  ["Instalação", "Reinstalação"].some((s) => service?.startsWith(s));
function requiredEquipment(order) {
  if (order.tracker_waiver_authorized || !isInstallation(order.service))
    return { RASTREADOR: 0, TAG: 0 };
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
module.exports = { isInstallation, requiredEquipment, prepareEquipment };
