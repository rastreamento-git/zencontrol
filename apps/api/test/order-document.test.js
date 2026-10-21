const { test } = require("node:test");
const assert = require("node:assert/strict");
const { orderPdf } = require("../src/pdf");
const { readPdf } = require("./helpers/pdf.cjs");
const { normalizeDocumentData, appointment } = require("../src/order-document");
const fixture = require("./fixtures/order-document.cjs");
test("standalone layout preserves four sections and uses OS assignment instead of document overrides", async () => {
  const pdf = await readPdf(
    await orderPdf({
      ...fixture,
      document_data: {
        ...fixture.document_data,
        service: "Retirada forjada",
        technician_name: "Nome forjado",
        scheduled_at: "1900-01-01",
      },
    }),
  );
  assert.equal(pdf.count, 1);
  for (const text of [
    "DADOS DO ASSOCIADO",
    "INFORMAÇÕES DO VEÍCULO",
    "DETALHES DO ATENDIMENTO",
    "INSTRUÇÕES / OBSERVAÇÕES GERAIS",
    "Instalação",
    "Técnico de Demonstração",
    "20/10/2026 às 14:30",
    "1x Rastreador",
    "1x Tag",
    "portal do técnico",
  ])
    assert.ok(pdf.text.includes(text), text);
  for (const text of [
    "Retirada forjada",
    "Nome forjado",
    "1900-01-01",
    "Finalize com .",
  ])
    assert.ok(!pdf.text.includes(text), text);
});
test("default document really omits identifiers while integral document retains the source values", async () => {
  const masked = await readPdf(await orderPdf(fixture)),
    full = await readPdf(await orderPdf(fixture, false));
  for (const text of [
    fixture.document_data.cpf_cnpj,
    fixture.document_data.rg,
    fixture.document_data.renavam,
    fixture.customer_name,
  ]) {
    assert.ok(!masked.text.includes(text), text);
    assert.ok(full.text.includes(text), text);
  }
  assert.ok(masked.text.includes("Associado Fictício ***"));
  assert.ok(masked.text.includes("***.***.***-**"));
  assert.ok(
    masked.text.includes(
      require("../../../packages/domain/order-fields.mjs").formatPhone(
        fixture.contact,
      ),
    ),
  );
  assert.ok(masked.text.includes(fixture.document_data.customer_address));
});
test("long instructions paginate without clipped text, missing continuation or empty pages", async () => {
  const notes =
    "Conferir equipamento, alimentação e comunicação.\n".repeat(110) +
    "FIM-DA-INSTRUCAO";
  const pdf = await readPdf(await orderPdf({ ...fixture, notes }));
  assert.ok(pdf.count > 1 && pdf.count <= 5);
  assert.ok(pdf.text.includes("FIM-DA-INSTRUCAO"));
  assert.ok(pdf.text.includes("CONTINUAÇÃO"));
  for (const [index, page] of pdf.pages.entries()) {
    assert.ok(page.text.includes(`Página ${index + 1} de ${pdf.count}`));
    for (const item of page.items) {
      assert.ok(
        item.transform[4] >= 39 &&
          item.transform[4] + item.width <= page.width - 38,
        JSON.stringify(item),
      );
      assert.ok(
        item.transform[5] > 15 && item.transform[5] < page.height - 30,
        JSON.stringify(item),
      );
    }
  }
});
test("incomplete appointments stay explicit and carrying equipment is implicit", async () => {
  const pdf = await readPdf(
    await orderPdf({
      ...fixture,
      technician_id: null,
      technician_name: "",
      scheduled_at: "",
      document_data: {
        ...fixture.document_data,
        technician_brings_equipment: false,
      },
    }),
  );
  assert.ok(pdf.text.includes("A combinar"));
  assert.ok(pdf.text.includes("NÃO ATRIBUÍDO"));
  assert.ok(!pdf.text.includes("NÃO levará"));
  assert.ok(!pdf.text.includes("DEVERÁ LEVAR"));
  assert.ok(pdf.text.includes("pendente de definição"));
  assert.equal(appointment("2026-10-20T14:30"), "20/10/2026 às 14:30");
  assert.equal(appointment("2026-10-20T17:30:00Z"), "20/10/2026 às 14:30");
});
test("document validation rejects execution metadata, unknown keys and invalid equipment without losing saved fields", () => {
  for (const data of [
    { service: "Instalação" },
    { scheduled_at: "2026-01-01" },
    { technician_id: 8 },
    { token: "secret" },
    { equipment: ["unknown"] },
    { technician_brings_equipment: "false" },
    { vehicle_electric: "false" },
    { fipe_region: "XX" },
    [],
  ])
    assert.throws(
      () => normalizeDocumentData(data),
      (e) => e.status === 400,
    );
  const updated = normalizeDocumentData(
    { brand: "Marca corrigida" },
    fixture.document_data,
  );
  assert.equal(updated.cpf_cnpj, fixture.document_data.cpf_cnpj);
  assert.equal(updated.brand, "Marca corrigida");
});
test("PDF includes FIPE category and electric vehicle warning without granting a tracker waiver", async () => {
  const pdf = await readPdf(
    await orderPdf({
      ...fixture,
      fipe_risk: "Média RJ",
      document_data: {
        ...fixture.document_data,
        vehicle_type: "Moto",
        fipe_region: "RJ",
        vehicle_electric: true,
      },
    }),
  );
  assert.match(pdf.text, /TIPO FIPE/);
  assert.match(pdf.text, /Média RJ/);
  assert.match(pdf.text, /VEÍCULO ELÉTRICO/);
  assert.match(pdf.text, /não autoriza dispensa/);
  assert.doesNotMatch(pdf.text, /DEVERÁ LEVAR/);
});
test("PDF apresenta dispensa autorizada e exclusão financeira sem instruir instalação", async () => {
  const pdf = await readPdf(
    await orderPdf({
      ...fixture,
      tracker_waiver_authorized: true,
      workflow_mode: "controlled",
    }),
  );
  assert.match(pdf.text, /DISPENSA DE RASTREADOR AUTORIZADA/);
  assert.match(pdf.text, /não integra a remuneração do técnico/);
  assert.match(pdf.text, /não registra instalação no Estoque Pro/);
  assert.ok(!pdf.text.includes("DEVERÁ LEVAR"));
});
