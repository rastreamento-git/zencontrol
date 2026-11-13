const d = require("./domain");
const { fail } = require("./errors");

async function documentOrder(db, order, technicianId = null) {
  let root = order;
  if (order.parent_order_id) {
    const parent = await d.one(
      db,
      "SELECT * FROM zc_orders WHERE id=$1 AND deleted_at=''",
      [order.parent_order_id],
    );
    if (
      parent &&
      (technicianId === null || parent.technician_id === technicianId)
    )
      root = parent;
  }
  if (technicianId !== null && root.technician_id !== technicianId)
    fail(404, "OS indisponível.");
  const children = await d.rows(
    db,
    "SELECT * FROM zc_orders WHERE parent_order_id=$1 AND deleted_at=''" +
      (technicianId === null ? "" : " AND technician_id=$2") +
      " ORDER BY id",
    technicianId === null ? [root.id] : [root.id, technicianId],
  );
  let counts = root.document_data?.equipment_counts;
  if (!counts) {
    counts = { tracker: 0, tag: 0 };
    for (const item of [root, ...children])
      for (const equipment of item.document_data?.equipment ||
        (item.service.startsWith("Instalação") ||
        item.service.startsWith("Reinstalação")
          ? ["tracker"]
          : []))
        counts[equipment === "tag" ? "tag" : "tracker"]++;
  }
  return {
    ...root,
    document_data: { ...root.document_data, equipment_counts: counts },
  };
}
module.exports = { documentOrder };
