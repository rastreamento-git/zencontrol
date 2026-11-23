const d = require("./domain");
const { fail } = require("./errors");
const { preparedData, existingOrder } = require("./sga-intake");
const { demand, simulate } = require("./sga-coverage");

async function read(pool, cfg, { page = 1, ids } = {}) {
  if (ids !== undefined) return simulate(pool, cfg, ids);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
    fail(400, "Página inválida.");
  const limit = 20;
  const condition = " FROM zc_sga_intake WHERE order_id IS NULL";
  const total = (await d.one(pool, "SELECT count(*)::int n" + condition)).n;
  const rows = await d.rows(
    pool,
    "SELECT *" +
      condition +
      " ORDER BY received_at DESC, id LIMIT $1 OFFSET $2",
    [limit, (page - 1) * limit],
  );
  const items = await Promise.all(
    rows.map(async (entry) => {
      const data = preparedData(entry);
      const ordered = Boolean(await existingOrder(pool, data));
      return {
        id: entry.id,
        vehicle: entry.vehicle,
        received_at: entry.received_at,
        classification: data.sga_classification || null,
        required: ordered ? null : demand(data),
        ordered,
      };
    }),
  );
  return { page, limit, total, items };
}

module.exports = { read };
