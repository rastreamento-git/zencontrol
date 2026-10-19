const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { spawn } = require("node:child_process"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  instance = "waiver-ui-" + randomUUID().slice(0, 8),
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
  server.stdout.on("data", (s) => {
    output += s;
  });
  server.stderr.on("data", (s) => {
    output += s;
  });
  for (let i = 0; i < 600; i++) {
    if (output.includes("Homologação LOCAL pronta.")) break;
    if (server.exitCode !== null)
      throw Error(
        "Inicializador falhou: " +
          output.replace(/Admin dos sistemas:.*/g, "[omitido]"),
      );
    await new Promise((r) => setTimeout(r, 200));
    if (i === 599)
      throw Error(
        "Inicialização demorou além do limite: " +
          output.replace(/Admin dos sistemas:.*/g, "[omitido]"),
      );
  }
  const creds = JSON.parse(
    await fs.readFile(path.join(directory, "access.json"), "utf8"),
  );
  async function api(route, body, token) {
    const r = await fetch("http://127.0.0.1:4317/api" + route, {
      method: body ? "POST" : "GET",
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
      password: creds.admin_password,
      audience: "ecosystem",
    })
  ).token;
  const access = await api("/technicians/1/activation", {}, admin),
    techPassword = "browser-test-technician-password";
  await api("/auth/activate", {
    login: access.login,
    password: "zen123",
    code: access.code,
    new_password: techPassword,
  });
  await api(
    "/users",
    {
      login: "operador.teste",
      nome: "Operador de teste",
      papel: "operador",
      password: "operator-browser-test-password",
    },
    admin,
  );
  const args = process.env.ZEN_CHROMIUM_MODULE
    ? (await import(process.env.ZEN_CHROMIUM_MODULE)).default.args.filter(
        (arg) =>
          ![
            "--single-process",
            "--disable-web-security",
            "--allow-running-insecure-content",
            "--disable-site-isolation-trials",
          ].includes(arg),
      )
    : undefined;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.ZEN_CHROMIUM_PATH
      ? { executablePath: process.env.ZEN_CHROMIUM_PATH }
      : {}),
    ...(args ? { args } : {}),
  });
  const errors = [];
  const central = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  central.setDefaultTimeout(10000);
  central.on("pageerror", (e) => errors.push(e.message));
  await central.goto("http://127.0.0.1:4320");
  await central.getByLabel("Usuário", { exact: true }).fill("admin");
  await central.getByLabel("Senha de acesso").fill(creds.admin_password);
  await central.getByRole("button", { name: "Entrar", exact: true }).click();
  await central
    .getByRole("button", { name: "Ordens de serviço", exact: true })
    .click();
  await central
    .getByRole("button", { name: "Nova ordem de serviço", exact: true })
    .click();
  await central.getByLabel("Placa ou chassi", { exact: true }).fill("DIS1A23");
  await central
    .getByLabel("Associado", { exact: true })
    .fill("Cliente fictício dispensa");
  await central.locator('select[name="technician_id"]').selectOption("1");
  await central
    .getByLabel("Data e horário", { exact: true })
    .fill("2026-10-19T10:00");
  await central
    .getByLabel("Dispensa de rastreador autorizada", { exact: true })
    .check();
  assert.equal(
    await central
      .getByText("Equipamentos previstos no atendimento", { exact: true })
      .count(),
    0,
  );
  await central
    .getByLabel("Dispensa de rastreador autorizada", { exact: true })
    .scrollIntoViewIfNeeded();
  await central.screenshot({
    path: path.join(directory, "central-waiver.png"),
    animations: "disabled",
    timeout: 60000,
  });
  await central
    .getByRole("button", { name: "Criar ordem de serviço", exact: true })
    .click();
  await central
    .getByRole("button", { name: "Nova ordem de serviço", exact: true })
    .waitFor();
  console.log("Central waiver saved through UI.");
  const list = await api("/orders?q=DIS1A23", undefined, admin);
  const order = list.items.find((o) => o.vehicle === "DIS1A23");
  assert.ok(
    order?.tracker_waiver_authorized,
    "Checkbox must reach persisted OS",
  );
  const tech = await browser.newPage({
    viewport: { width: 390, height: 700 },
    isMobile: true,
    hasTouch: true,
  });
  tech.setDefaultTimeout(10000);
  tech.on("pageerror", (e) => errors.push(e.message));
  await tech.goto("http://127.0.0.1:4320");
  await tech.getByLabel("Usuário", { exact: true }).fill(access.login);
  await tech.getByLabel("Senha de acesso").fill(techPassword);
  await tech.getByRole("button", { name: "Entrar", exact: true }).click();
  await tech.waitForURL("http://127.0.0.1:4319/**");
  await tech
    .getByRole("button", { name: "Meus serviços", exact: true })
    .click();
  await tech.locator(".portal-order").filter({ hasText: "DIS1A23" }).click();
  await tech
    .getByText("Dispensa de rastreador autorizada", { exact: true })
    .waitFor();
  await tech
    .getByRole("button", { name: "Começar registro", exact: true })
    .click();
  await tech
    .getByRole("heading", {
      name: "Checklist preenchido e assinado",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await tech
      .getByRole("heading", {
        name: "Foto do rastreador ou da TAG",
        exact: true,
      })
      .count(),
    0,
  );
  await tech
    .getByText("Dispensa de rastreador autorizada", { exact: true })
    .scrollIntoViewIfNeeded();
  await tech.screenshot({ path: path.join(directory, "zenfield-waiver.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: central checkbox -> API -> persisted OS -> mobile ZenField notice and waiver requirements.",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
  });
