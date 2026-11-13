const { createHash } = require("node:crypto");
const d = require("./domain");
const norm = (v) => d.normalized(v || "").replace(/\s+/g, " ");
const lineId = (r) => r.sheet + ":" + r.row;
function devices(row) {
  const source = norm(row.source_service),
    doc = row.data.document_data || {};
  const counts =
    doc.equipment_counts ||
    (source.includes("DUAS TAG")
      ? { tracker: 0, tag: 2 }
      : source.includes("TAG")
        ? { tracker: source.includes("INSTALACAO") ? 1 : 0, tag: 1 }
        : { tracker: 1, tag: 0 });
  const types = [
    ...Array(counts.tracker).fill("RASTREADOR"),
    ...Array(counts.tag).fill("TAG"),
  ];
  if (doc.equipment?.[0] === "tag") {
    const i = types.indexOf("TAG");
    if (i > 0) types.unshift(...types.splice(i, 1));
  }
  return types.map((type, i) => ({
    type,
    serial: i === 0 ? row.data.imei : "",
    completion_date_source: row.completion_date_source,
    source_key: row.key,
    position: i,
  }));
}
function groupRows(input) {
  const rows = structuredClone(input),
    buckets = new Map(),
    removed = new Set();
  for (const r of rows) {
    if (!r.data || !r.data.customer_name || !r.data.vehicle) continue;
    const key = JSON.stringify([
      norm(r.data.customer_name),
      d.vehicle(r.data.vehicle),
    ]);
    const list = buckets.get(key) || [];
    list.push(r);
    buckets.set(key, list);
  }
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const primary = list[0],
      equipment = [],
      serials = new Set(),
      emptySources = new Set();
    let repeated = false;
    for (const row of list)
      for (const device of devices(row)) {
        const identity = device.source_key + ":" + device.position;
        if (
          device.serial
            ? serials.has(device.serial)
            : emptySources.has(identity)
        ) {
          repeated = true;
          continue;
        }
        if (device.serial) serials.add(device.serial);
        else emptySources.add(identity);
        const emptySlot =
          device.serial &&
          equipment.find(
            (e) => e.type === device.type && !e.serial && e.position > 0,
          );
        if (emptySlot) {
          emptySlot.serial = device.serial;
          emptySlot.completion_date_source = device.completion_date_source;
          continue;
        }
        equipment.push(device);
      }
    primary.sources = list.map((r) => ({
      sheet: r.sheet,
      row: r.row,
      key: r.key,
      values: r.raw,
      service: r.data.service,
      imei: r.data.imei,
      sga: r.sga,
    }));
    primary.equipment = equipment;
    primary.additional_imei = equipment[1]?.serial || "";
    primary.additional_orders = Math.max(0, equipment.length - 1);
    primary.key = createHash("sha256")
      .update([...new Set(list.map((r) => r.key))].sort().join(":"))
      .digest("hex");
    primary.match = JSON.stringify([
      norm(primary.data.customer_name),
      d.vehicle(primary.data.vehicle),
    ]);
    primary.data.document_data = {
      ...primary.data.document_data,
      equipment_counts: {
        tracker: equipment.filter((e) => e.type === "RASTREADOR").length,
        tag: equipment.filter((e) => e.type === "TAG").length,
      },
      equipment: [equipment[0]?.type === "TAG" ? "tag" : "tracker"],
    };
    const pending = list.filter((r) => r.state === "pending");
    if (pending.length) {
      primary.state = "pending";
      primary.reason = [...new Set(pending.map((r) => r.reason))].join("; ");
    }
    primary.inference.push(
      `${list.length} linhas agrupadas automaticamente por nome e placa/chassi; IMEIs distintos mantidos como equipamentos adicionais.`,
    );
    const differences = list
      .slice(1)
      .some((r) =>
        [
          "service",
          "status",
          "technician_name",
          "completed_at",
          "scheduled_at",
          "shift",
          "location",
          "notes",
          "term",
          "fipe_value",
          "fipe_risk",
          "volunteer",
        ].some((k) => r.data[k] !== primary.data[k]),
      );
    primary.group_warning = differences || repeated;
    if (differences)
      primary.inference.push(
        "Alerta: há diferenças entre as origens. Os dados principais seguem a primeira linha; todo o conteúdo de origem foi preservado.",
      );
    if (repeated)
      primary.inference.push(
        "Alerta: IMEI/linha repetido foi contado uma única vez, mantendo todas as origens.",
      );
    if (equipment.length > 20) {
      primary.state = "pending";
      primary.reason =
        "Atendimento com mais de 20 equipamentos; revise conforme o limite do sistema.";
    }
    for (const row of list.slice(1)) removed.add(row);
  }
  return rows.filter((r) => !removed.has(r));
}
module.exports = { groupRows, lineId };
