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
  for (let i = 0; i < 600; i++) {
    if (output.includes("Homologação LOCAL pronta.")) break;
    if (server.exitCode !== null)
      throw Error(
        "Inicializador falhou: " +
          output.replace(/Admin dos sistemas:.*/g, "[omitido]"),
      );
    await new Promise((r) => setTimeout(r, 200));
    if (i === 599) throw Error("Inicialização demorou além do limite.");
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
  const people = (await api("/technicians", undefined, admin)).items;
  const first = people.find((t) => t.id === 1),
    second = people.find((t) => t.id === 2);
  for (const [login, password] of [
    ["admin", creds.admin_password],
    ["operador.teste", "Operator1!browser"],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:4320");
    await page
      .getByRole("heading", { name: "ZenTracking", exact: true })
      .waitFor();
    await page.getByLabel("Usuário", { exact: true }).fill(login);
    await page.getByLabel("Senha de acesso").fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page
      .getByRole("heading", { name: "Seu setor, em um só lugar.", exact: true })
      .waitFor();
    for (const name of ["ZenControl", "ZenField", "EstoquePro"])
      await page
        .getByRole("button", { name: "Abrir " + name, exact: true })
        .waitFor();
    if (login === "admin") {
      await page.screenshot({
        path: path.join(directory, "zentracking-desktop.png"),
        timeout: 60000,
        animations: "disabled",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Hub must fit mobile width",
      );
      await page.screenshot({
        path: path.join(directory, "zentracking-mobile.png"),
        fullPage: true,
        timeout: 60000,
        animations: "disabled",
      });
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await page
      .getByRole("button", { name: "Abrir ZenControl", exact: true })
      .click();
    await page.waitForURL("http://127.0.0.1:4320/zencontrol");
    await page
      .getByRole("button", { name: "Equipe e acessos", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Financeiro", exact: true })
      .waitFor();
    await page.getByRole("link", { name: "Aplicativos", exact: true }).click();
    await page
      .getByRole("button", { name: "Abrir EstoquePro", exact: true })
      .click();
    await page.waitForURL("http://127.0.0.1:4321/**");
    await page.getByRole("button", { name: "Sair", exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Backups locais", exact: true })
      .waitFor();
    await page
      .getByRole("link", { name: "ZenTracking · Aplicativos", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Abrir ZenField", exact: true })
      .click();
    await page.waitForURL("http://127.0.0.1:4319/**");
    assert.equal(
      await page
        .getByRole("heading", {
          name: "Seu setor, em um só lugar.",
          exact: true,
        })
        .count(),
      0,
    );
    await page
      .getByRole("heading", {
        name: "Qual técnico você quer acessar?",
        exact: true,
      })
      .waitFor();
    const notificationResponse = page.waitForResponse(
      (r) =>
        r.url().includes("/notifications?") &&
        r.request().headers()["x-zen-technician-id"] === "1",
    );
    await page
      .getByRole("button", {
        name: "Acessar ambiente de " + first.name,
        exact: true,
      })
      .click();
    await page
      .getByLabel("Ambiente selecionado", { exact: true })
      .getByText("Ambiente de " + first.name, { exact: true })
      .waitFor();
    assert.equal(
      (await notificationResponse).status(),
      200,
      "Notifications must use selected technician",
    );
    await page
      .getByRole("button", { name: "Meus serviços", exact: true })
      .click();
    await page.locator(".portal-order").first().click();
    await page
      .getByText("Ordem de serviço completa", { exact: true })
      .waitFor();
    const start = page.getByRole("button", {
      name: "Começar registro",
      exact: true,
    });
    if (await start.count()) await start.click();
    await page
      .getByRole("heading", {
        name: "Checklist preenchido e assinado",
        exact: true,
      })
      .waitFor();
    await page
      .getByLabel("Observações do atendimento (opcional)", { exact: true })
      .fill("Registro realizado pela central: " + login);
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        /\/technician\/batches\//.test(r.url()),
    );
    await page
      .getByRole("button", { name: "Salvar e continuar depois", exact: true })
      .click();
    const result = await saved;
    assert.equal(result.status(), 200);
    const id = result.url().split("/").at(-1);
    const staffToken = await page.evaluate(() =>
      sessionStorage.getItem("zenfield.session"),
    );
    const audit = await api("/audit?limit=100", undefined, staffToken);
    const row = audit.items.find(
      (x) =>
        x.action === "portal_draft_updated" &&
        x.entity_id === id &&
        x.detail.delegation?.actor_login === login,
    );
    assert.ok(row, "Delegated UI action must preserve real operator identity");
    assert.equal(row.detail.delegation.technician_id, 1);
    await page
      .getByRole("button", { name: "Trocar técnico", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Acessar ambiente de " + second.name,
        exact: true,
      })
      .click();
    await page
      .getByLabel("Ambiente selecionado", { exact: true })
      .getByText("Ambiente de " + second.name, { exact: true })
      .waitFor();
    if (login === "admin") {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Supervision must fit mobile width",
      );
      await page.screenshot({
        path: path.join(directory, "zenfield-supervision.png"),
        fullPage: true,
        timeout: 60000,
        animations: "disabled",
      });
    }
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await page
      .getByRole("button", { name: "Entrar no ZenTracking", exact: true })
      .waitFor();
    await page.goto("http://127.0.0.1:4320");
    await page.getByLabel("Senha de acesso").waitFor();
    await context.close();
    console.log(
      "Staff flow passed: " +
        login +
        "; three apps, technician switch, direct action, audit and logout.",
    );
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
  await page.getByText("Ordem de serviço completa", { exact: true }).waitFor();
  if (
    await page
      .getByRole("button", { name: "Começar registro", exact: true })
      .count()
  )
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
    .getByRole("button", { name: "Entrar no ZenTracking", exact: true })
    .waitFor();
  await context.close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      staffSso:
        "passed: ZenTracking cards → all three apps for admin and operator",
      supervision:
        "passed: select, switch, operate and audit actual staff identity",
      technician: "passed: master login routes directly to field",
      mobileScroll: "passed at 390×520, including after dialog",
      horizontalOverflow: false,
      logout: "passed",
      pageErrors: errors,
    }),
  );
}
main()
  .catch(async (e) => {
    for (const context of browser?.contexts() || []) {
      for (const page of context.pages()) {
        console.error("UI failure at", page.url());
        console.error((await page.locator("body").innerText()).slice(-12000));
        await page
          .screenshot({
            path: path.join(directory, "failure.png"),
            fullPage: true,
            timeout: 60000,
          })
          .catch(() => {});
      }
    }
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
