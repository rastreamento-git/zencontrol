const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyFipe,
  fipeCents,
} = require("../../../packages/domain/fipe.mjs");
const { mapSgaVehicle } = require("../src/order-document");

for (const [vehicleType, limits] of [
  ["Automóvel", { GERAL: 70000, SP: 40000, RJ: 30000 }],
  ["Moto", { GERAL: 40000, SP: 25000, RJ: 20000 }],
])
  for (const [region, minimum] of Object.entries(limits)) {
    test(`FIPE ${vehicleType}/${region}: centavo abaixo, limites exatos e Alta`, () => {
      const label = (value) =>
        classifyFipe({ value, vehicleType, region }).label;
      const suffix = region === "GERAL" ? "" : " " + region;
      assert.equal(label(minimum - 0.01), "Baixa" + suffix);
      assert.equal(label(minimum), "Média" + suffix);
      assert.equal(label(80000), "Média" + suffix);
      assert.equal(label("R$ 80.000,01"), "Alta");
    });
  }
test("Alta applies to every vehicle and region; lower categories need explicit type and region", () => {
  assert.equal(classifyFipe({ value: "80000.01" }).label, "Alta");
  assert.equal(
    classifyFipe({ value: 100000, vehicleType: "Caminhão", region: "" }).label,
    "Alta",
  );
  assert.equal(
    classifyFipe({ value: 30000, vehicleType: "Caminhão", region: "SP" })
      .status,
    "unsupported_type",
  );
  assert.equal(
    classifyFipe({ value: 30000, vehicleType: "Moto" }).status,
    "missing_region",
  );
  assert.equal(
    classifyFipe({ value: 30000, region: "SP" }).status,
    "missing_type",
  );
  assert.equal(
    classifyFipe({
      value: "30.000,00",
      vehicleType: " MOTOCICLETA ",
      region: "SP",
    }).label,
    "Média SP",
  );
});
test("currency parsing uses exact cents and rejects malformed, zero and negative values", () => {
  for (const v of ["R$ 70.000,00", "70.000", "70000", "70000.00", 70000])
    assert.equal(fipeCents(v), 7000000);
  for (const v of [
    "-1",
    "0",
    0,
    "NaN",
    "1e6",
    "abc",
    "12,345",
    {},
    "1.00.000",
  ]) {
    assert.equal(fipeCents(v), null);
    assert.equal(classifyFipe({ value: v }).label, "");
  }
  assert.equal(classifyFipe().status, "missing_value");
});
test("SGA vehicle type remains distinct from FIPE category and does not assume a regional rule", () => {
  const result = mapSgaVehicle({
    tipo: "Automóvel",
    valor_fipe: "45000",
    estado: "SP",
  });
  assert.equal(result.document_data.vehicle_type, "Automóvel");
  assert.equal(result.fipe_risk, "");
  assert.equal(result.document_data.fipe_region, undefined);
});
