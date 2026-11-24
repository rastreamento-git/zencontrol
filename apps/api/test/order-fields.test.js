const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  formatPhone,
  phoneDigits,
  formatAddress,
} = require("../../../packages/domain/order-fields.mjs");
const {
  normalizeDocumentData,
  orderDocument,
} = require("../src/order-document");
const {
  prepareEquipment,
  requiredEquipment,
} = require("../src/equipment-plan");
test("contact mask handles mobile, landline, country prefix and progressive typing", () => {
  assert.equal(formatPhone("11987654321"), "(11)98765-4321");
  assert.equal(formatPhone("+55 (21) 98765-4321"), "(21)98765-4321");
  assert.equal(formatPhone("1134567890"), "(11)3456-7890");
  assert.equal(phoneDigits("+551134567890"), "1134567890");
  assert.equal(formatPhone("11"), "(11");
  assert.equal(formatPhone("119"), "(11)9");
  assert.equal(formatPhone(""), "");
});
test("structured address retains number, block, complement, neighborhood, city and UF", () => {
  const address = {
    customer_street: "Rua de Exemplo",
    customer_number: "120",
    customer_block: "B",
    customer_complement: "Apartamento 302",
    customer_neighborhood: "Centro",
    customer_city: "Niterói",
    customer_state: "RJ",
  };
  assert.equal(
    formatAddress(address),
    "Rua de Exemplo, 120 - Bloco B · Apartamento 302 - Centro - Niterói / RJ",
  );
  const data = normalizeDocumentData({
    ...address,
    service_address_same: true,
  });
  assert.equal(data.customer_address, formatAddress(address));
  assert.equal(
    normalizeDocumentData({ customer_state: "sp" }).customer_state,
    "SP",
  );
  assert.throws(() => normalizeDocumentData({ customer_state: "ZZ" }));
  assert.equal(
    normalizeDocumentData(
      { brand: "Marca" },
      { customer_address: "Endereço legado" },
    ).customer_address,
    "Endereço legado",
  );
});
test("quantities default to one tracker, each extra is a service, and invalid quantities are refused", () => {
  const fresh = { service: "Instalação" };
  assert.deepEqual(prepareEquipment(fresh, {}), []);
  assert.deepEqual(JSON.parse(fresh.document_data).equipment_counts, {
    tracker: 1,
    tag: 0,
  });
  const document = normalizeDocumentData({
    equipment_counts: { tracker: 2, tag: 2 },
  });
  const data = {
    service: "Instalação",
    document_data: JSON.stringify(document),
  };
  assert.deepEqual(prepareEquipment(data, {}), ["RASTREADOR", "TAG", "TAG"]);
  assert.deepEqual(
    requiredEquipment({
      service: data.service,
      document_data: JSON.parse(data.document_data),
    }),
    { RASTREADOR: 2, TAG: 2 },
  );
  for (const counts of [
    { tracker: -1, tag: 0 },
    { tracker: 1.5, tag: 0 },
    { tracker: 20, tag: 1 },
    { tracker: "2", tag: 0 },
    { tracker: 1 },
    [1, 2],
  ])
    assert.throws(() => normalizeDocumentData({ equipment_counts: counts }));
  assert.throws(() =>
    prepareEquipment(
      {
        service: "Instalação",
        document_data: JSON.stringify({
          equipment_counts: { tracker: 0, tag: 0 },
        }),
      },
      {},
    ),
  );
});
test("PDF view uses the whole equipment plan and no carrying-equipment flag", () => {
  const view = orderDocument({
    id: "OS-TESTE",
    vehicle: "TES1A23",
    service: "Reinstalação",
    contact: "11987654321",
    document_data: {
      equipment_counts: { tracker: 2, tag: 2 },
      reinstallation: true,
      reuse_equipment: true,
      technician_brings_equipment: false,
    },
  });
  assert.match(view.instructions, /2x Rastreador/);
  assert.match(view.instructions, /2x TAG/);
  assert.match(view.instructions, /REINSTALAÇÃO COM REAPROVEITAMENTO/);
  assert.doesNotMatch(view.instructions, /DEVERÁ LEVAR|NÃO levará/);
  assert.equal(view.customer.contact, "(11)98765-4321");
});
