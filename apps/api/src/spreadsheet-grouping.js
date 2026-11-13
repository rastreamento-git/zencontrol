const { createHash } = require("node:crypto");
const d = require("./domain");
const norm = (v) => d.normalized(v || "").replace(/\s+/g, " ");
function kind(r) {
  if (r.additional_orders) return null;
  const s = norm(r.source_service);
  return /TAG/.test(s) && !/INSTALACAO/.test(s)
    ? "tag"
    : r.data?.service
      ? "tracker"
      : null;
}
const { fail } = require("./errors");
const lineId = (r) => r.sheet + ":" + r.row;
function groupRows(input, groups = []) {
  if (!Array.isArray(groups) || groups.length > 15000)
    fail(400, "Selecione os pares de linhas manualmente.");
  const rows = structuredClone(input),
    removed = new Set(),
    used = new Set();
  const byId = new Map(rows.map((row) => [lineId(row), row]));
  for (const pair of groups) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      pair.some((id) => typeof id !== "string" || used.has(id)) ||
      pair[0] === pair[1]
    )
      fail(400, "Cada linha pode pertencer a um único agrupamento.");
    const list = pair.map((id) => byId.get(id));
    if (list.some((r) => !r || r.state !== "ready" || !kind(r)))
      fail(
        400,
        "Selecione duas linhas sem pendências para definir o IMEI principal e o adicional.",
      );
    const signature = (r) =>
      JSON.stringify([norm(r.data.customer_name), d.vehicle(r.data.vehicle)]);
    if (signature(list[0]) !== signature(list[1]))
      fail(400, "Agrupe somente linhas do mesmo nome e placa/chassi.");
    pair.forEach((id) => used.add(id));
    const [tracker, tag] = list;
    if (tracker.data.imei && tracker.data.imei === tag.data.imei)
      fail(
        400,
        "Os equipamentos selecionados possuem o mesmo número de série.",
      );
    tracker.sources = list.map((r) => ({
      sheet: r.sheet,
      row: r.row,
      key: r.key,
      values: r.raw,
      service: r.data.service,
      imei: r.data.imei,
    }));
    tracker.equipment = [
      {
        type: kind(tracker) === "tag" ? "TAG" : "RASTREADOR",
        serial: tracker.data.imei,
        completion_date_source: tracker.completion_date_source,
      },
      {
        type: kind(tag) === "tag" ? "TAG" : "RASTREADOR",
        serial: tag.data.imei,
        completion_date_source: tag.completion_date_source,
      },
    ];
    tracker.key = createHash("sha256")
      .update(
        list
          .map((r) => r.key)
          .sort()
          .join(":"),
      )
      .digest("hex");
    tracker.additional_imei = tag.data.imei;
    tracker.match = JSON.stringify([
      norm(tracker.data.customer_name),
      tracker.data.vehicle,
    ]);
    tracker.data.document_data = {
      ...tracker.data.document_data,
      equipment_counts: {
        tracker: list.filter((r) => kind(r) === "tracker").length,
        tag: list.filter((r) => kind(r) === "tag").length,
      },
      equipment: [kind(tracker)],
    };
    tracker.additional_orders = 1;
    tracker.inference.push(
      "Agrupamento manual: primeira linha = IMEI principal; segunda linha = IMEI adicional. Serviço, situação e técnico seguem a primeira linha; as duas origens são preservadas.",
    );
    if (
      [
        "service",
        "status",
        "technician_name",
        "completed_at",
        "scheduled_at",
      ].some((key) => tracker.data[key] !== tag.data[key])
    ) {
      tracker.group_warning = true;
      tracker.inference.push(
        "Existem diferenças entre as linhas agrupadas. Confira os dados da primeira linha antes de confirmar.",
      );
    }
    removed.add(tag);
  }
  const result = rows.filter((r) => !removed.has(r)),
    seen = new Map();
  for (const r of result.filter((r) => r.state === "ready")) {
    const other = seen.get(r.match);
    if (other) {
      r.state = other.state = "duplicate";
      r.reason = other.reason =
        "Atendimentos semelhantes: revisar repetição ou composição antes de importar.";
    } else seen.set(r.match, r);
  }
  return result;
}
module.exports = { groupRows, lineId };
