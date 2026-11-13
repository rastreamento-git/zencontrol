const { createHash } = require("node:crypto");
const d = require("./domain");
const norm = (v) => d.normalized(v || "").replace(/\s+/g, " ");
function kind(r) {
  const s = norm(r.source_service);
  return s === "TAG" ? "tag" : s === "INSTALACAO" ? "tracker" : null;
}
function groupRows(input, enabled = true) {
  const rows = structuredClone(input),
    candidates = new Map();
  for (const r of rows) {
    if (r.state !== "ready" || !kind(r)) continue;
    const key = JSON.stringify([
      r.sheet,
      norm(r.data.customer_name),
      r.data.vehicle,
      norm(r.data.technician_name),
      r.data.status,
      r.data.completed_at,
      r.data.scheduled_at,
      r.data.shift,
    ]);
    const list = candidates.get(key) || [];
    list.push(r);
    candidates.set(key, list);
  }
  const removed = new Set();
  if (enabled)
    for (const list of candidates.values()) {
      // Only an unambiguous complementary pair is combined. Repeated or conflicting visits need review.
      if (list.length !== 2 || new Set(list.map(kind)).size !== 2) continue;
      const tracker = list.find((r) => kind(r) === "tracker"),
        tag = list.find((r) => kind(r) === "tag");
      if (tracker.data.imei && tracker.data.imei === tag.data.imei) continue;
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
        "Duas linhas compatíveis agrupadas em um atendimento: rastreador + TAG",
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
module.exports = { groupRows };
