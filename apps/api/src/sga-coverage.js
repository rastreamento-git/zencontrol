const d = require("./domain");
const { fail } = require("./errors");
const intake = require("./sga-intake");
const { StockClient } = require("./stock-client");
const recommendations = require("./technician-recommendations");

const keys = ["RASTREADOR", "TAG", "PERFURADO"];
const quantities = (fn = () => 0) =>
  Object.fromEntries(keys.map((key) => [key, fn(key)]));
const hasUnits = (value) => keys.some((key) => value[key] > 0);

function demand(data) {
  const sticker = data.sticker_discount_opt_in ?? data.sga_products?.perfurado;
  const electric = data.coverage_choices?.electric;
  const customer_choice = data.coverage_choices?.customer_choice;
  if (typeof sticker !== "boolean" || !electric) return null;
  try {
    const result = intake.equipmentForIntake(data, {
      electric,
      customer_choice,
    });
    return {
      RASTREADOR: result.equipment_counts.tracker,
      TAG: result.equipment_counts.tag,
      PERFURADO: Number(sticker),
    };
  } catch (error) {
    if (error.status === 400 || error.status === 409) return null;
    throw error;
  }
}

function allocate(required, items, matrix, loads) {
  const candidates = items.filter((item) => item.route.state === "confirmed");
  const closest = candidates.find((item) => item.nearest_geographic);
  const options = candidates
    .map((item) => {
      if (!loads.has(item.id) && item.stock)
        loads.set(item.id, { ...item.stock.free });
      const free = loads.get(item.id);
      const missing =
        free && keys.every((key) => !required[key] || free[key] != null)
          ? quantities((key) => Math.max(0, required[key] - (free[key] ?? 0)))
          : null;
      return {
        id: item.id,
        name: item.name,
        route: item.route,
        free: free ? { ...free } : null,
        missing,
      };
    })
    .sort(
      (a, b) =>
        a.route.distance_meters - b.route.distance_meters ||
        a.route.duration_seconds - b.route.duration_seconds ||
        a.id - b.id,
    );

  const nearest =
    options.find((option) => option.id === closest?.id) || options[0];
  const direct = options.find(
    (option) => option.missing && !hasUnits(option.missing),
  );
  const transfer = options.find(
    (option) =>
      option.missing &&
      hasUnits(option.missing) &&
      matrix &&
      keys.every((key) => option.missing[key] <= matrix[key]),
  );
  const selected = direct || transfer;
  if (!selected) {
    const known = options.find((option) => option.missing);
    const missing =
      known && matrix
        ? quantities((key) => Math.max(0, known.missing[key] - matrix[key]))
        : null;
    const state = !options.length
      ? "route_pending"
      : !matrix || options.some((option) => !option.missing)
        ? "stock_pending"
        : "shortage";
    return { state, nearest, missing: state === "shortage" ? missing : null };
  }
  const free = loads.get(selected.id);
  for (const key of keys) {
    if (!required[key]) continue;
    free[key] -= required[key] - selected.missing[key];
    if (matrix) matrix[key] -= selected.missing[key];
  }
  return {
    state: direct ? "covered" : "matrix_transfer",
    nearest,
    selected,
    direct,
    matrix_option: transfer,
  };
}

async function simulate(
  pool,
  cfg,
  ids,
  { stock = new StockClient(cfg), recommend = recommendations.recommend } = {},
) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 5 ||
    ids.some(
      (id) =>
        typeof id !== "string" ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id),
    )
  )
    fail(400, "Selecione de uma a cinco pendências para simular.");
  const entries = await d.rows(
    pool,
    "SELECT * FROM zc_sga_intake WHERE id=ANY($1::text[]) AND order_id IS NULL",
    [[...new Set(ids)]],
  );
  if (entries.length !== new Set(ids).size)
    fail(409, "A fila mudou. Atualize as pendências e simule novamente.");
  entries.sort(
    (a, b) =>
      (a.data?.coverage_scheduled_at || "9999").localeCompare(
        b.data?.coverage_scheduled_at || "9999",
      ) ||
      a.received_at.localeCompare(b.received_at) ||
      a.id.localeCompare(b.id),
  );

  const snapshot = await stock.matrix().catch(() => null);
  const matrix =
    snapshot &&
    keys.every(
      (key) => Number.isSafeInteger(snapshot[key]) && snapshot[key] >= 0,
    )
      ? quantities((key) => snapshot[key])
      : null;
  const initialMatrix = matrix && { ...matrix };
  const stockLoads = new Map();
  const sharedStock = {
    items(id) {
      if (!stockLoads.has(id)) stockLoads.set(id, stock.items(id));
      return stockLoads.get(id);
    },
  };
  const loads = new Map();
  const items = [];
  for (const entry of entries) {
    const data = intake.preparedData(entry);
    const item = {
      id: entry.id,
      vehicle: entry.vehicle,
      date: data.coverage_scheduled_at || null,
    };
    if (await intake.existingOrder(pool, data)) {
      items.push({ ...item, state: "already_ordered" });
      continue;
    }
    const required = demand(data);
    if (!required) {
      items.push({ ...item, state: "demand_pending" });
      continue;
    }
    const address = Object.fromEntries(
      ["street", "number", "neighborhood", "city", "state"].map((key) => [
        key,
        data.document_data["customer_" + key],
      ]),
    );
    const input = { address, required };
    try {
      recommendations.validateInput(input);
    } catch (error) {
      if (error.status !== 400) throw error;
      items.push({ ...item, required, state: "route_pending" });
      continue;
    }
    const result = await recommend(pool, cfg, input, { stock: sharedStock });
    items.push({
      ...item,
      required,
      ...allocate(required, result.items, matrix, loads),
    });
  }

  const totals = {
    required: quantities(),
    covered: quantities(),
    from_matrix: quantities(),
    missing: quantities(),
    pending: quantities(),
    pending_items: 0,
  };
  for (const item of items) {
    if (item.state === "already_ordered") continue;
    if (!["covered", "matrix_transfer", "shortage"].includes(item.state))
      totals.pending_items++;
    for (const key of keys) {
      if (!item.required) continue;
      totals.required[key] += item.required[key];
      if (item.selected) {
        totals.covered[key] += item.required[key] - item.selected.missing[key];
        totals.from_matrix[key] += item.selected.missing[key];
      } else if (item.missing) {
        totals.missing[key] += item.missing[key];
        // An incomplete kit does not consume stock in the simulation.
        totals.pending[key] += item.required[key] - item.missing[key];
      } else totals.pending[key] += item.required[key];
    }
  }
  return {
    items,
    totals,
    matrix: initialMatrix,
    matrix_remaining: matrix,
    checked_at: new Date().toISOString(),
  };
}

module.exports = { simulate, allocate, demand };
