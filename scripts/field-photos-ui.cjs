const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { spawn } = require("node:child_process"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  instance = "photos-ui-" + randomUUID().slice(0, 8),
  directory = path.join(root, ".homologation-" + instance);
let server, browser, page;
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
    if (server.exitCode !== null) throw Error("Falha no inicializador local.");
    if (i === 599) throw Error("Inicialização excedeu o limite.");
    await new Promise((r) => setTimeout(r, 200));
  }
  const credentials = JSON.parse(
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
      password: credentials.admin_password,
    })
  ).token;
  const access = await api("/technicians/1/activation", {}, admin),
    password = "Photos1!browser";
  await api("/auth/activate", {
    login: access.login,
    password: "zen123",
    code: access.code,
    new_password: password,
  });
  const token = (
    await api("/auth/login", {
      login: access.login,
      password,
      audience: "technician",
    })
  ).token;
  const args = process.env.ZEN_CHROMIUM_MODULE
    ? (await import(process.env.ZEN_CHROMIUM_MODULE)).default.args.filter(
        (a) =>
          ![
            "--single-process",
            "--disable-web-security",
            "--allow-running-insecure-content",
            "--disable-site-isolation-trials",
          ].includes(a),
      )
    : undefined;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.ZEN_CHROMIUM_PATH
      ? { executablePath: process.env.ZEN_CHROMIUM_PATH }
      : {}),
    ...(args ? { args } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(
    (value) => sessionStorage.setItem("zenfield.session", value),
    token,
  );
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4319");
  await page
    .getByRole("button", { name: "Meus serviços", exact: true })
    .click();
  await page.locator(".portal-order").filter({ hasText: "ZEN1A23" }).click();
  await page
    .getByRole("button", { name: "Começar registro", exact: true })
    .click();
  const general = page.locator(".portal-capture-group").filter({
    has: page.getByRole("heading", {
      name: "Fotos do atendimento",
      exact: true,
    }),
  });
  await general
    .getByRole("heading", { name: "Fotos do atendimento", exact: true })
    .waitFor();
  assert.equal(await page.locator(".portal-capture-group").count(), 1);
  for (const name of [
    "Placa ou chassi",
    "Equipamento instalado",
    "Fotos da vistoria",
    "Fotos complementares",
  ])
    assert.equal(
      await page.getByRole("heading", { name, exact: true }).count(),
      0,
    );
  async function upload(section, fixture, status, kind) {
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/photos") && r.request().method() === "POST",
    );
    await section
      .getByLabel("Escolher foto", { exact: true })
      .setInputFiles(path.join(directory, "fixtures", fixture));
    const r = await response;
    assert.equal(r.status(), status, await r.text());
    const body = r.request().postDataJSON();
    assert.equal(body.kind, kind);
    await section
      .getByLabel("Escolher foto", { exact: true })
      .waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("input[type=file]")].some(
          (e) => e.disabled,
        ),
    );
    return r.json();
  }
  const equipment = page.locator("section.portal-step").filter({
    has: page.getByRole("heading", {
      name: "Foto do rastreador ou da TAG",
      exact: true,
    }),
  });
  await upload(equipment, "foto-vistoria-exemplo.jpg", 400, "label");
  await equipment.getByRole("alert").filter({ hasText: "ilegível" }).waitFor();
  assert.equal(await equipment.locator(".portal-photo").count(), 0);
  await equipment.screenshot({
    path: path.join(directory, "unreadable-warning.png"),
    timeout: 60000,
  });
  await upload(equipment, "rastreador-maria.jpg", 400, "label");
  await equipment
    .getByRole("alert")
    .filter({ hasText: "não corresponde" })
    .waitFor();
  assert.equal(await equipment.locator(".portal-photo").count(), 0);
  await upload(equipment, "rastreador-jose.jpg", 201, "label");
  await equipment
    .getByText("Rastreador identificado", { exact: true })
    .waitFor();
  await upload(equipment, "tag-jose.jpg", 201, "label");
  await equipment.getByText("TAG identificada", { exact: true }).waitFor();
  assert.equal(await equipment.getByRole("alert").count(), 0);
  for (let i = 0; i < 3; i++)
    await upload(general, "foto-vistoria-exemplo.jpg", 201, undefined);
  assert.equal(await general.locator(".portal-photo").count(), 3);
  assert.equal(
    await general.getByText("Foto do atendimento", { exact: true }).count(),
    3,
  );
  const checklistResponse = page.waitForResponse(
    (r) => r.url().endsWith("/photos") && r.request().method() === "POST",
  );
  await page
    .getByLabel("Anexar checklist assinado", { exact: true })
    .setInputFiles(path.join(directory, "fixtures/checklist-ficticio.pdf"));
  assert.equal((await checklistResponse).status(), 201);
  await page
    .getByLabel("O checklist anexado está preenchido e assinado.", {
      exact: true,
    })
    .check();
  await page
    .getByLabel("Conferi a OS, as fotos e os equipamentos deste atendimento.", {
      exact: true,
    })
    .check();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await equipment.screenshot({
    path: path.join(directory, "identified-equipment.png"),
    timeout: 60000,
  });
  const sent = page.waitForResponse(
    (r) => r.url().endsWith("/submit") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Enviar e aguardar confirmação", exact: true })
    .click();
  assert.equal((await sent).status(), 200);
  const orders = await api("/technician/orders?view=open", undefined, token),
    order = orders.items.find((o) => o.vehicle === "ZEN1A23");
  const detail = await api("/technician/orders/" + order.id, undefined, token),
    batch = detail.submissions.find((b) => b.state === "submitted");
  assert.deepEqual(batch.imeis, ["123456789012345", "TAG-HOMO-001"]);
  assert.equal(batch.files.filter((f) => f.kind === "other").length, 3);
  assert.equal(batch.files.filter((f) => f.kind === "label").length, 2);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      generalPhotos: "passed: no category and preserved minimum",
      barcode: "passed: tracker IMEI",
      qr: "passed: TAG serial",
      warnings: "passed: unreadable and wrong technician load; neither saved",
      submission: "passed: checklist and both identified devices",
      mobile: "390px without horizontal overflow",
      pageErrors: errors,
    }),
  );
}
main()
  .catch(async (e) => {
    console.error(e);
    if (page) {
      console.error((await page.locator("body").innerText()).slice(-7000));
      await page
        .screenshot({
          path: path.join(directory, "failure.png"),
          fullPage: true,
          timeout: 60000,
        })
        .catch(() => {});
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
  });
