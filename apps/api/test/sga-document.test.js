const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { SGAClient } = require("../src/integrations");
const cfg = {
  INTEGRATIONS_ENABLED: true,
  HINOVA_TOKEN_ASSOC: "test-only-association-token",
  HINOVA_USER: "test-user",
  HINOVA_PASS: "test-only-password",
  HINOVA_API_URL: "https://sga.example.invalid",
};
function mock(t, handler) {
  const original = global.fetch,
    calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    const result = handler(new URL(url).pathname, options);
    return new Response(JSON.stringify(result.data ?? result), {
      status: result.status || 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    global.fetch = original;
  });
  return calls;
}
test("SGA plate search loads full ID record, volunteer and only whitelisted document data", async (t) => {
  const calls = mock(t, (path) => {
    if (path === "/usuario/autenticar")
      return { token_usuario: "test-only-user-token" };
    if (path === "/veiculo/buscar/QAT1A23/placa")
      return [
        {
          codigo_veiculo: 42,
          placa: "QAT1A23",
          nome: "Associado de teste",
          marca: "Marca resumida",
        },
      ];
    if (path === "/veiculo/buscar/42/id")
      return {
        codigo_veiculo: 42,
        placa: "QAT1A23",
        marca: null,
        descricao_modelo: "Modelo completo",
        cpf: "000.000.000-00",
        rg: "00",
        renavam: "00000000000",
        ano_fabricacao: 2025,
        ano_modelo: 2026,
        valor_fipe: "45000",
        codigo_voluntario: 7,
        logradouro: "Rua fictícia",
        numero: "10",
        categoria: "Particular",
        codigo_classificacao: 21,
        service: "FORJADO",
        senha: "never-copy",
        token: "never-copy",
      };
    if (path === "/buscar/voluntario/7")
      return [{ nome: "Voluntário de exemplo" }];
    throw Error("Unexpected route " + path);
  });
  const result = await new SGAClient(cfg).lookup("qat-1a23");
  assert.equal(result.document_data.brand, "Marca resumida");
  assert.equal(result.document_data.model, "Modelo completo");
  assert.equal(result.document_data.cpf_cnpj, "000.000.000-00");
  assert.equal(result.document_data.year, "2025/2026");
  assert.equal(result.volunteer, "Voluntário de exemplo");
  assert.equal(result.sga_classification, "Instalação agendada");
  assert.equal(result.document_data.customer_address, "Rua fictícia, 10");
  assert.ok(!JSON.stringify(result).includes("never-copy"));
  assert.equal(result.service, undefined);
  assert.equal(result.technician_id, undefined);
  assert.equal(result.scheduled_at, undefined);
  assert.equal(
    calls.filter((c) => c.url.endsWith("/usuario/autenticar")).length,
    1,
  );
});
test("SGA supports ID and chassis, keeps usable data when optional detail lookup fails", async (t) => {
  const calls = mock(t, (path) => {
    if (path === "/usuario/autenticar") return { token_usuario: "test-token" };
    if (path === "/veiculo/buscar/42/id")
      return [
        {
          codigo_veiculo: 42,
          chassi: "CHASSIFICTICIO0001",
          nome: "Exemplo",
          codigo_voluntario: 7,
        },
      ];
    if (path === "/buscar/voluntario/7")
      return { status: 503, data: { error: "Offline" } };
    if (path === "/veiculo/buscar/CHASSIFICTICIO0001/chassi")
      return [
        { codigo_veiculo: 42, chassi: "CHASSIFICTICIO0001", nome: "Exemplo" },
      ];
    throw Error(path);
  });
  const client = new SGAClient(cfg);
  assert.equal((await client.lookup({ sga_id: "42" })).sga_id, "42");
  assert.equal(
    (await client.lookup({ chassis: "CHASSIFICTICIO0001" })).chassis,
    "CHASSIFICTICIO0001",
  );
  assert.equal(
    calls.filter((c) => c.url.includes("/veiculo/buscar/42/id")).length,
    2,
  );
});
test("invalid SGA search is rejected before network access and empty results do not invent a customer", async (t) => {
  const calls = mock(t, (path) =>
    path === "/usuario/autenticar" ? { token_usuario: "test-token" } : [],
  );
  const client = new SGAClient(cfg);
  await assert.rejects(client.lookup("abc"), /válido/);
  assert.equal(calls.length, 0);
  await assert.rejects(client.lookup("QAT1A23"), /não encontrado/);
});
