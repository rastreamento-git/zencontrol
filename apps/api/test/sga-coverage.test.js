const { test } = require("node:test");
const assert = require("node:assert/strict");
const { allocate, demand } = require("../src/sga-coverage");

const stock = (RASTREADOR, TAG) => ({ RASTREADOR, TAG, PERFURADO: 0 });
const candidate = (id, distance_meters, free, routeState = "confirmed") => ({
  id,
  name: String(id),
  nearest_geographic: id === 1,
  route: {
    state: routeState,
    distance_meters,
    duration_seconds: distance_meters,
  },
  stock: free && { free },
});

test("prefers a complete technician and accounts for the alternative from the matrix", () => {
  const items = [candidate(1, 12, stock(1, 0)), candidate(2, 25, stock(1, 1))];
  const matrix = stock(0, 1);
  const loads = new Map();
  const first = allocate(stock(1, 1), items, matrix, loads);
  assert.equal(first.state, "covered");
  assert.equal(first.selected.id, 2);
  assert.equal(first.nearest.id, 1);
  assert.equal(first.matrix_option.id, 1);
  assert.equal(matrix.TAG, 1);
  const second = allocate(stock(1, 1), items, matrix, loads);
  assert.equal(second.state, "matrix_transfer");
  assert.equal(second.selected.id, 1);
  assert.equal(matrix.TAG, 0);
  assert.equal(allocate(stock(1, 1), items, matrix, loads).state, "shortage");
});

test("missing routes or stock never consume matrix stock", () => {
  const matrix = stock(1, 1);
  assert.equal(
    allocate(
      stock(1, 1),
      [candidate(1, 12, stock(1, 1), "unavailable")],
      matrix,
      new Map(),
    ).state,
    "route_pending",
  );
  assert.equal(
    allocate(stock(1, 1), [candidate(1, 12, null)], matrix, new Map()).state,
    "stock_pending",
  );
  assert.deepEqual(matrix, stock(1, 1));
});

test("requires confirmed choices and reuses the intake rule for electric TAG-only service", () => {
  const data = {
    fipe_value: "R$ 65.000,00",
    document_data: {
      vehicle_type: "Automóvel",
      fipe_region: "SP",
      fipe_override: "Alta",
    },
    sticker_discount_opt_in: false,
  };
  assert.equal(demand(data), null);
  assert.equal(
    demand({ ...data, coverage_choices: { electric: "yes" } }),
    null,
  );
  assert.deepEqual(
    demand({
      ...data,
      coverage_choices: { electric: "yes", customer_choice: "tag_only" },
    }),
    stock(0, 1),
  );
});
