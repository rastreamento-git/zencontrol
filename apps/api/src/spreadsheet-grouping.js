const { createHash } = require("node:crypto");
const d = require("./domain");
const norm = (v) => d.normalized(v || "").replace(/\s+/g, " ");
function kind(r) {
  const s = norm(r.source_service);
  return s === "TAG" ? "tag" : s === "INSTALACAO" ? "tracker" : null;
}
const { fail } = require("./errors");
const lineId = (r) => r.sheet + ":" + r.row;
function groupRows(input, groups = []) {
  if (!Array.isArray(groups) || groups.length > 15000)
    fail(400, "Selecione os pares de linhas manualmente.");
  const rows = structuredClone(input),
    removed = new Set(),
    used = new Set();
  for (const pair of groups) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      pair.some((id) => typeof id !== "string" || used.has(id)) ||
      pair[0] === pair[1]
    )
      fail(400, "Cada linha pode pertencer a um único agrupamento.");
    const list = pair.map((id) => rows.find((r) => lineId(r) === id));
    if (list.some((r) => !r || r.state !== "ready" || !kind(r)))
      fail(
        400,
        "Selecione uma linha de instalação e uma de TAG, sem pendências.",
      );
    const signature = (r) =>
      JSON.stringify([
        r.sheet,
        norm(r.data.customer_name),
        r.data.vehicle,
        norm(r.data.technician_name),
        r.data.status,
        r.data.completed_at,
        r.data.scheduled_at,
        r.data.shift,
      ]);
    if (
      new Set(list.map(kind)).size !== 2 ||
      signature(list[0]) !== signature(list[1])
    )
      fail(
        400,
        "As linhas escolhidas possuem tipo, atendimento, data ou situação incompatível. Revise a origem.",
      );
    pair.forEach((id) => used.add(id));
    const tracker = list.find((r) => kind(r) === "tracker"),
      tag = list.find((r) => kind(r) === "tag");
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
      { type: "RASTREADOR", serial: tracker.data.imei },
      { type: "TAG", serial: tag.data.imei },
    ];
    tracker.key = createHash("sha256")
      .update(
        list
          .map((r) => r.key)
          .sort()
          .join(":"),
      )
      .digest("hex");
    tracker.data.service = "Instalação";
    tracker.match = JSON.stringify([
      norm("Instalação"),
      norm(tracker.data.customer_name),
      tracker.data.vehicle,
    ]);
    tracker.data.document_data = {
      equipment_counts: { tracker: 1, tag: 1 },
      equipment: ["tracker"],
    };
    tracker.additional_orders = 1;
    tracker.inference.push(
      "Agrupamento manual confirmado pelo responsável: rastreador + TAG",
    );
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
