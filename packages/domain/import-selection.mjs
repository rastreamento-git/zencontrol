const norm = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
export const lineId = (row) => row.sheet + ":" + row.row;
export const canSelect = (row) =>
  !row.sources &&
  !row.additional_orders &&
  ["ready", "duplicate"].includes(row.state) &&
  !!row.data?.service;
export function planGroups(rows, selected) {
  const byId = new Map(rows.filter(canSelect).map((row) => [lineId(row), row]));
  const groups = new Map();
  for (const id of new Set(selected)) {
    const row = byId.get(id);
    if (!row) continue;
    const key = JSON.stringify([
      norm(row.data.customer_name),
      norm(row.data.vehicle).replace(/[^A-Z0-9]/g, ""),
    ]);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const pairs = [];
  let ambiguous = 0,
    singles = 0;
  for (const group of groups.values()) {
    if (group.length === 1) {
      singles++;
      continue;
    }
    if (
      group.length !== 2 ||
      (group[0].data.imei && group[0].data.imei === group[1].data.imei)
    ) {
      ambiguous++;
      continue;
    }
    pairs.push(group.map(lineId));
  }
  return { pairs, ambiguous, singles };
}
