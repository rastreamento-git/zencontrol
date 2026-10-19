const fs = require("node:fs/promises"),
  path = require("node:path"),
  { spawn } = require("node:child_process"),
  { randomUUID } = require("node:crypto"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright"),
  { once } = require("node:events");
const root = path.resolve(__dirname, ".."),
  instance = "ui-" + randomUUID().slice(0, 8),
  directory = path.join(root, ".homologation-" + instance);
let server, browser;
async function main() {
  server = spawn(
    process.execPath,
    [path.join(root, "scripts/homologation.cjs")],
    {
      cwd: root,
      env: { ...process.env, ZEN_HOMOLOGY_INSTANCE: instance },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk;
  });
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  for (let i = 0; i < 150; i++) {
    if (output.includes("Homologação LOCAL pronta.")) break;
    if (server.exitCode !== null)
      throw Error(
        "Inicializador falhou: " +
          output.replace(/Admin dos sistemas:.*/g, "[credencial omitida]"),
      );
    await new Promise((r) => setTimeout(r, 200));
    if (i === 149) throw Error("Ambiente não iniciou no prazo.");
  }
  const credentials = JSON.parse(
    await fs.readFile(path.join(directory, "access.json"), "utf8"),
  );
  async function api(route, body, token, method = body ? "POST" : "GET") {
    const r = await fetch("http://127.0.0.1:4317/api" + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    assert.ok(r.ok, JSON.stringify(data));
    return data;
  }
  const admin = (
    await api("/auth/login", {
      login: "admin",
      password: credentials.admin_password,
    })
  ).token;
  const crossApp = await fetch("http://127.0.0.1:4318/api/produtos", {
    headers: { Authorization: "Bearer " + admin },
  });
  assert.equal(
    crossApp.status,
    401,
    "Inventory must reject central session tokens",
  );
  const access = await api("/technicians/1/activation", {}, admin),
    password = "homologation-browser-only-password";
  let args;
  if (process.env.ZEN_CHROMIUM_MODULE)
    args = (await import(process.env.ZEN_CHROMIUM_MODULE)).default.args;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.ZEN_CHROMIUM_PATH
      ? { executablePath: process.env.ZEN_CHROMIUM_PATH }
      : {}),
    ...(args ? { args } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("UI error: " + e.message);
  });
  await page.goto("http://127.0.0.1:4320");
  await page.getByLabel("Usuário", { exact: true }).fill(access.login);
  await page.getByLabel("Senha de acesso").fill("zen123");
  await page.getByLabel("Primeiro acesso ou redefinição").check();
  await page
    .getByLabel("Código individual fornecido pela central")
    .fill(access.code);
  await page.getByLabel("Nova senha (mínimo 12 caracteres)").fill(password);
  await page.getByRole("button", { name: "Ativar conta", exact: true }).click();
  await page
    .getByText("Conta ativada. Entre com sua nova senha.", { exact: true })
    .waitFor();
  await page.getByLabel("Senha de acesso").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Seu dia em campo", exact: true })
    .waitFor();
  await page.screenshot({
    path: path.join(directory, "mobile-dashboard.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Meu estoque", exact: true }).click();
  await page
    .getByRole("heading", { name: "Meu estoque", exact: true })
    .waitFor();
  await page
    .getByRole("cell", { name: "123456789012345", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Solicitar movimentação", exact: true })
    .click();
  await page
    .getByLabel("Justificativa", { exact: true })
    .fill("Reposição fictícia para homologação");
  await page
    .getByRole("button", { name: "Enviar para aprovação", exact: true })
    .click();
  await page
    .getByText("Reposição fictícia para homologação", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Meus valores", exact: true }).click();
  await page
    .getByRole("heading", { name: "Tarifas vigentes", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Solicitar reajuste", exact: true })
    .click();
  await page.getByLabel("Instalação (R$)", { exact: true }).fill("100");
  await page
    .getByLabel("Justificativa", { exact: true })
    .fill("Reajuste fictício sujeito à central");
  await page
    .getByRole("button", { name: "Enviar para aprovação", exact: true })
    .click();
  await page
    .getByText("Reajuste fictício sujeito à central", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Meus serviços", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Meus serviços", exact: true })
    .waitFor();
  await page.getByLabel("Veículo", { exact: true }).fill("ZEN1A23");
  await page.getByRole("heading", { name: "ZEN1A23", exact: true }).waitFor();
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", { name: "ZEN1A23", exact: true }),
    })
    .click();
  await page
    .getByRole("button", { name: "Começar registro", exact: true })
    .click();
  const group = (name) =>
    page
      .locator(".portal-capture-group")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  for (const name of [
    "Placa ou chassi",
    "Equipamento instalado",
    "Fotos da vistoria",
  ]) {
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/photos") && r.request().method() === "POST",
    );
    await group(name)
      .getByLabel("Escolher foto", { exact: true })
      .setInputFiles(
        path.join(directory, "fixtures/foto-vistoria-exemplo.jpg"),
      );
    assert.equal((await response).status(), 201);
    await page
      .getByRole("status")
      .filter({ hasText: "Enviando arquivo" })
      .waitFor({ state: "hidden" });
  }
  const equipment = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Foto do rastreador ou da TAG",
      exact: true,
    }),
  });
  let response = page.waitForResponse(
    (r) => r.url().endsWith("/photos") && r.request().method() === "POST",
  );
  await equipment
    .getByLabel("Escolher foto", { exact: true })
    .setInputFiles(path.join(directory, "fixtures/foto-vistoria-exemplo.jpg"));
  assert.equal((await response).status(), 400);
  await page.getByRole("alert").filter({ hasText: "ilegível" }).waitFor();
  response = page.waitForResponse(
    (r) => r.url().endsWith("/photos") && r.request().method() === "POST",
  );
  await equipment
    .getByLabel("Escolher foto", { exact: true })
    .setInputFiles(path.join(directory, "fixtures/rastreador-jose.jpg"));
  assert.equal((await response).status(), 201);
  await page.getByText("Rastreador identificado", { exact: true }).waitFor();
  response = page.waitForResponse(
    (r) => r.url().endsWith("/photos") && r.request().method() === "POST",
  );
  await page
    .getByLabel("Anexar checklist assinado", { exact: true })
    .setInputFiles(path.join(directory, "fixtures/checklist-ficticio.pdf"));
  assert.equal((await response).status(), 201);
  await page
    .getByText("Baixar checklist assinado (PDF)", { exact: true })
    .waitFor();
  await page.getByLabel("Data efetiva da execução", { exact: true }).fill(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  await page
    .getByLabel("O checklist anexado está preenchido e assinado.", {
      exact: true,
    })
    .check();
  response = page.waitForResponse(
    (r) => r.url().endsWith("/finish") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Registrar execução finalizada", exact: true })
    .click();
  assert.equal((await response).status(), 200);
  await page
    .getByText("Execução finalizada pelo técnico", { exact: true })
    .waitFor();
  await page
    .getByLabel("Conferi a OS, as fotos e os equipamentos deste atendimento.", {
      exact: true,
    })
    .check();
  response = page.waitForResponse(
    (r) => r.url().endsWith("/submit") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Enviar e aguardar confirmação", exact: true })
    .click();
  assert.equal((await response).status(), 200);
  await page.getByText("Confirmação pendente", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const central = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  central.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("UI error: " + e.message);
  });
  await central.addInitScript(
    (token) => sessionStorage.setItem("zencontrol.session", token),
    admin,
  );
  await central.goto("http://127.0.0.1:4320");
  await central
    .getByRole("button", { name: "Validações", exact: true })
    .click();
  await central.getByRole("button", { name: "Conferir", exact: true }).click();
  await central
    .getByLabel("Resultado da conferência / correção necessária", {
      exact: true,
    })
    .fill("Conferência fictícia da instalação, documentos e identificação.");
  await central
    .getByLabel("Conferi veículo, técnico, fotos e códigos deste serviço.", {
      exact: true,
    })
    .check();
  assert.equal(
    await central
      .getByRole("button", { name: "Aprovar conferência", exact: true })
      .isDisabled(),
    true,
  );
  await central
    .getByLabel("Abri o checklist e conferi o preenchimento e a assinatura.", {
      exact: true,
    })
    .check();
  response = central.waitForResponse(
    (r) => r.url().endsWith("/approve") && r.request().method() === "POST",
  );
  await central
    .getByRole("button", { name: "Aprovar conferência", exact: true })
    .click();
  assert.equal((await response).status(), 200);
  const submitted = (await api("/batches", null, admin)).items.find(
    (b) => b.source === "portal",
  );
  assert.ok(submitted);
  let confirmed;
  for (let i = 0; i < 40; i++) {
    confirmed = await api("/orders/" + submitted.order_id, null, admin);
    if (confirmed.status === "CONCLUÍDO") break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(confirmed.status, "CONCLUÍDO");
  assert.equal(confirmed.stock_sync_state, "confirmed");
  assert.equal(confirmed.stock_receipt.status, "INSTALADO");
  const fieldToken = await page.evaluate(() =>
    sessionStorage.getItem("zenfield.session"),
  );
  const stockAfter = await api("/technician/stock", null, fieldToken);
  assert.equal(
    stockAfter.items.some((e) => e.codigo_serial === "123456789012345"),
    false,
  );
  await central
    .getByRole("button", { name: "Fechar diálogo", exact: true })
    .click();
  await central
    .getByRole("button", { name: "Financeiro", exact: true })
    .click();
  await central
    .getByRole("heading", { name: "Fechamentos e pagamentos", exact: true })
    .waitFor();
  await central.getByLabel("Técnico", { exact: true }).selectOption("1");
  await central
    .getByRole("heading", { name: "Fechamentos anteriores", exact: true })
    .waitFor();
  await central.getByText("Pagamento parcial", { exact: true }).waitFor();
  // Close and pay the newly executed OS through the real UI.
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const begin = await central
    .getByLabel("Início", { exact: true })
    .inputValue();
  await central.getByLabel("Fim", { exact: true }).fill(day);
  await central
    .getByLabel("Fechamento extraordinário autorizado", { exact: true })
    .check();
  await central
    .getByLabel("Justificativa do fechamento", { exact: true })
    .fill("Ciclo extraordinário fictício da instalação");
  await central
    .getByRole("button", { name: "Gerar prévia", exact: true })
    .click();
  await central
    .getByRole("button", {
      name: "Criar fechamento para conferência",
      exact: true,
    })
    .click();
  const freshClosing = central.locator("article").filter({
    has: central.getByRole("heading", {
      name: begin + " a " + day,
      exact: true,
    }),
  });
  await freshClosing
    .getByRole("button", { name: "Aprovar fechamento", exact: true })
    .click();
  await freshClosing
    .getByRole("button", { name: "Registrar pagamento externo", exact: true })
    .click();
  await central
    .getByLabel("Referência do pagamento externo", { exact: true })
    .fill("SIMULADO-BROWSER-INSTALACAO");
  await central
    .getByRole("button", { name: "Confirmar registro", exact: true })
    .click();
  await freshClosing.getByText("Quitado", { exact: true }).waitFor();
  // Respond to the rate request from the central interface.
  const request = central.locator("article").filter({
    has: central.getByRole("heading", {
      name: "Reajuste de tarifas",
      exact: true,
    }),
  });
  await request
    .getByRole("button", { name: "Responder solicitação", exact: true })
    .click();
  await central.getByLabel("Decisão", { exact: true }).selectOption("approve");
  await central
    .getByLabel("Resposta e justificativa", { exact: true })
    .fill("Reajuste fictício autorizado pela central");
  await central
    .getByRole("button", { name: "Registrar decisão", exact: true })
    .click();
  await request.getByText("Aprovado", { exact: true }).waitFor();
  // Complete the existing demonstration payment without banking traffic.
  await central
    .getByRole("button", { name: "Registrar pagamento externo", exact: true })
    .click();
  await central
    .getByLabel("Referência do pagamento externo", { exact: true })
    .fill("SIMULADO-BROWSER-QUITACAO");
  await central
    .getByRole("button", { name: "Confirmar registro", exact: true })
    .click();
  await central.getByText("Quitado", { exact: true }).first().waitFor();
  await page
    .getByRole("button", { name: "Meu financeiro", exact: true })
    .click();
  await page.getByText("Quitado", { exact: true }).first().waitFor();
  await page.screenshot({
    path: path.join(directory, "mobile-finance.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await central.screenshot({
    path: path.join(directory, "central-finance.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const summary = {
    activation: "passed",
    mobile390: "passed",
    stockRequests: "passed",
    rateRequestsAndApproval: "passed",
    photosBarcodeAndChecklist: "passed",
    centralReview: "passed",
    stockReceipt: "passed: official receipt and load decreased",
    partialAndFullSimulatedPayment: "passed",
    horizontalOverflow: false,
    javascriptErrors: errors,
  };
  await fs.writeFile(
    path.join(directory, "ui-result.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify({ ...summary, evidence_directory: directory }));
}
main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
  });
