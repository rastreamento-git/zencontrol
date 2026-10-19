const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { spawn } = require("node:child_process"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  instance = "access-ui-" + randomUUID().slice(0, 8),
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
  for (let i = 0; i < 200; i++) {
    if (output.includes("Homologação LOCAL pronta.")) break;
    if (server.exitCode !== null)
      throw Error(
        "Inicializador falhou: " +
          output.replace(/Admin dos sistemas:.*/g, "[omitido]"),
      );
    await new Promise((r) => setTimeout(r, 200));
    if (i === 199) throw Error("Inicialização demorou além do limite.");
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
    techPassword = "Technician1!browser";
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
      password: "Operator1!browser",
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
  for (const [login, password] of [
    ["admin", creds.admin_password],
    ["operador.teste", "Operator1!browser"],
  ]) {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:4320");
    await page.getByLabel("Usuário", { exact: true }).fill(login);
    await page.getByLabel("Senha de acesso").fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page
      .getByRole("button", { name: "Abrir Estoque Pro", exact: true })
      .click();
    await page.waitForURL("http://127.0.0.1:4321/**");
    await page.getByRole("button", { name: "Sair", exact: true }).waitFor();
    assert.ok(
      await page
        .getByText(login === "admin" ? "Administrador" : "Operador de teste", {
          exact: true,
        })
        .count(),
    );
    await page
      .getByRole("link", { name: "Abrir ZenControl", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Abrir Estoque Pro", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await page.getByLabel("Senha de acesso").waitFor();
    await context.close();
  }
  const context = await browser.newContext({
      viewport: { width: 390, height: 520 },
      isMobile: true,
      hasTouch: true,
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4320");
  await page.getByLabel("Usuário", { exact: true }).fill(access.login);
  await page.getByLabel("Senha de acesso").fill(techPassword);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("http://127.0.0.1:4319/**");
  await page.getByRole("button", { name: "Sair", exact: true }).waitFor();
  assert.ok(
    await page.getByText("Seus serviços em campo", { exact: true }).count(),
  );
  await page
    .getByRole("button", { name: "Meus serviços", exact: true })
    .click();
  await page.locator(".portal-order").first().click();
  await page
    .getByRole("button", { name: "Começar registro", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Checklist preenchido e assinado",
      exact: true,
    })
    .waitFor();
  const before = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
    x: document.documentElement.scrollWidth,
    w: window.innerWidth,
  }));
  assert.ok(
    before.height > before.viewport,
    "Service should extend beyond the viewport",
  );
  assert.ok(before.x <= before.w, "No horizontal overflow");
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(150);
  assert.ok(
    (await page.evaluate(() => window.scrollY)) > 100,
    "Page scroll must work on phones",
  );
  await page
    .getByRole("heading", {
      name: "Checklist preenchido e assinado",
      exact: true,
    })
    .first()
    .scrollIntoViewIfNeeded();
  assert.ok((await page.evaluate(() => window.scrollY)) > 0);
  await page.screenshot({
    path: path.join(directory, "zenfield-scroll.png"),
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Alterar senha", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fechar diálogo", exact: true })
    .click();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(100);
  assert.ok(
    (await page.evaluate(() => window.scrollY)) > 0,
    "Page remains scrollable after dialog",
  );
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await page
    .getByRole("button", { name: "Entrar com conta ZEN", exact: true })
    .waitFor();
  await context.close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      staffSso: "passed: admin and operator, central → stock → central",
      technician: "passed: master login routes directly to field",
      mobileScroll: "passed at 390×520, including after dialog",
      horizontalOverflow: false,
      logout: "passed",
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
