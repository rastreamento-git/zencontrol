const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { spawn } = require("node:child_process"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  instance = "orders-ui-" + randomUUID().slice(0, 8),
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
  server.stdout.on("data", (s) => (output += s));
  server.stderr.on("data", (s) => (output += s));
  for (let i = 0; i < 600; i++) {
    if (output.includes("Homologação LOCAL pronta.")) break;
    if (server.exitCode !== null || i === 599)
      throw Error("Inicialização local indisponível.");
    await new Promise((r) => setTimeout(r, 200));
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
  const access = await api("/technicians/1/activation", {}, admin),
    password = "Aa1!bcde";
  await api("/auth/activate", {
    login: access.login,
    password: "zen123",
    code: access.code,
    new_password: password,
  });
  const techLogin = await api("/auth/login", {
    login: access.login,
    password,
    audience: "technician",
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.ZEN_CHROMIUM_PATH
      ? { executablePath: process.env.ZEN_CHROMIUM_PATH }
      : {}),
  });
  const central = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    }),
    errors = [];
  central.on("pageerror", (e) => errors.push(e.message));
  await central.goto("http://127.0.0.1:4320");
  await central.getByLabel("Usuário", { exact: true }).fill("admin");
  await central.getByLabel("Senha de acesso").fill(credentials.admin_password);
  await central.getByRole("button", { name: "Entrar", exact: true }).click();
  await central
    .getByRole("button", { name: "Abrir ZenControl", exact: true })
    .click();
  await central
    .getByRole("button", { name: "Ordens de serviço", exact: true })
    .click();
  await central
    .getByRole("button", { name: "Nova ordem de serviço", exact: true })
    .click();
  await central.getByLabel("Placa ou chassi", { exact: true }).fill("FIP1A23");
  await central
    .getByLabel("Associado", { exact: true })
    .fill("Cliente fictício FIPE");
  await central
    .getByLabel("Tipo de veículo", { exact: true })
    .selectOption("Automóvel");
  await central
    .getByLabel("Regra regional FIPE", { exact: true })
    .selectOption("SP");
  const fipe = central.locator(".zc-fipe-result output");
  for (const [value, label] of [
    ["39.999,99", "Baixa SP"],
    ["40.000,00", "Média SP"],
    ["80.000,00", "Média SP"],
    ["80.000,01", "Alta"],
  ]) {
    await central.getByLabel("Valor FIPE", { exact: true }).fill(value);
    assert.equal(await fipe.innerText(), label);
  }
  await central
    .getByLabel("Tipo de veículo", { exact: true })
    .selectOption("Moto");
  await central
    .getByLabel("Regra regional FIPE", { exact: true })
    .selectOption("RJ");
  await central.getByLabel("Valor FIPE", { exact: true }).fill("20.000,00");
  assert.equal(await fipe.innerText(), "Média RJ");
  await central.getByLabel("Veículo elétrico", { exact: true }).check();
  assert.equal(await central.getByLabel("Termo", { exact: true }).count(), 0);
  assert.equal(await central.locator('input[name="imei"]').count(), 0);
  await central.getByLabel("Serviço", { exact: true }).selectOption("Visita");
  await central.locator('select[name="technician_id"]').selectOption("1");
  await central
    .getByLabel("Data e horário", { exact: true })
    .fill("2026-10-20T10:00");
  await central
    .getByLabel("Observações da central", { exact: true })
    .fill("Confirmar autorização do cliente para instalação.");
  await central
    .locator(".zc-fipe-result")
    .screenshot({ path: path.join(directory, "fipe-classification.png") });
  await central
    .getByRole("button", { name: "Criar ordem de serviço", exact: true })
    .click();
  await central
    .getByRole("button", { name: "Nova ordem de serviço", exact: true })
    .waitFor();
  const order = (await api("/orders?q=FIP1A23", undefined, admin)).items[0];
  assert.equal(order.fipe_risk, "Média RJ");
  assert.equal(order.vehicle_electric, true);
  assert.equal(order.tracker_waiver_authorized, false);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await ctx.addInitScript(
    (token) => sessionStorage.setItem("zenfield.session", token),
    techLogin.token,
  );
  const field = await ctx.newPage();
  field.on("pageerror", (e) => errors.push(e.message));
  await field.goto("http://127.0.0.1:4319");
  await field
    .getByRole("button", { name: "Meus serviços", exact: true })
    .click();
  await field
    .locator(".portal-order")
    .filter({ has: field.getByText(order.id, { exact: true }) })
    .click();
  await field.getByText("Veículo elétrico", { exact: true }).waitFor();
  await field
    .getByRole("button", { name: "Começar registro", exact: true })
    .click();
  const uploaded = field.waitForResponse(
    (r) => r.url().endsWith("/photos") && r.request().method() === "POST",
  );
  await field
    .getByLabel("Anexar checklist assinado", { exact: true })
    .setInputFiles(path.join(directory, "fixtures/checklist-ficticio.pdf"));
  assert.equal((await uploaded).status(), 201);
  await field
    .getByLabel("O checklist anexado está preenchido e assinado.", {
      exact: true,
    })
    .check();
  const send = field.getByRole("button", {
    name: "Enviar e aguardar confirmação",
    exact: true,
  });
  assert.ok(await send.isDisabled());
  const notes =
    "Cliente atendido e orientado sobre o procedimento no veículo elétrico.";
  await field
    .getByLabel("Observações do técnico (obrigatórias)", { exact: true })
    .fill(notes);
  const finished = field.waitForResponse(
    (r) => r.url().endsWith("/finish") && r.request().method() === "POST",
  );
  await field
    .getByRole("button", { name: "Registrar execução finalizada", exact: true })
    .click();
  assert.equal((await finished).status(), 200);
  await field
    .getByLabel("Conferi a OS, as fotos e os equipamentos deste atendimento.", {
      exact: true,
    })
    .check();
  const sent = field.waitForResponse(
    (r) => r.url().endsWith("/submit") && r.request().method() === "POST",
  );
  await send.click();
  assert.equal((await sent).status(), 200);
  await central.getByRole("button", { name: order.id, exact: true }).click();
  const readonly = central.getByLabel("Observações do técnico", {
    exact: true,
  });
  await readonly.waitFor();
  assert.equal(await readonly.inputValue(), notes);
  assert.ok((await readonly.getAttribute("readonly")) !== null);
  const summary = central.locator(".zc-audit-summary");
  assert.ok((await summary.innerText()).includes(techLogin.user.nome));
  await summary.scrollIntoViewIfNeeded();
  await central.screenshot({ path: path.join(directory, "order-audit.png") });
  assert.equal(
    await field.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      fipe: "six boundaries verified in unit tests; live form values verified",
      electric: "persisted in central and displayed in Field without waiver",
      notes: "mandatory finish and submit, readonly in central",
      audit: "friendly technician name rendered",
      mobile: "390px without horizontal overflow",
      pageErrors: errors,
    }),
  );
}
main()
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
