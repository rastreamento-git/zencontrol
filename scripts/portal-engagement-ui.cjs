// Local synthetic users only. The Google provider is mocked for this browser flow.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const instance = "portal-" + randomBytes(4).toString("hex");
const directory = path.join(root, ".homologation-" + instance);
const hub = "http://127.0.0.1:4320";
const clientId = "123456-browser-test.apps.googleusercontent.com";
const summary = {};
const errors = [];
const pages = [];
const googleResponses = [];
let server, browser, temp;

async function until(fn, message) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw Error(message);
}
async function pageFor(subject, viewport) {
  const context = await browser.newContext({ viewport });
  await context.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
        window.google = { accounts: { id: {
          initialize(options) { this.options = options; },
          renderButton(node) {
            const options = this.options;
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = "Continuar com o Google";
            button.addEventListener("click", () => {
              const claim = { sub: ${JSON.stringify(subject)}, email: ${JSON.stringify(subject + "@example.test")},
                email_verified: true, nonce: options.nonce };
              const payload = btoa(JSON.stringify(claim)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
              options.callback({ credential: "fixture." + payload + ".simulada" });
            });
            node.appendChild(button);
          }
        } } };
      `,
    }),
  );
  const page = await context.newPage();
  pages.push(page);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      url.pathname.includes("/auth/google/") ||
      url.pathname === "/gsi/client"
    )
      googleResponses.push({ path: url.pathname, status: response.status() });
  });
  page.setDefaultTimeout(12000);
  return page;
}
async function passwordLogin(page, login, password) {
  await page.goto(hub);
  await page.getByLabel("Usuário", { exact: true }).fill(login);
  await page.getByLabel("Senha de acesso", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}
async function profile(page, name, password, email) {
  await page.getByRole("button", { name: "Meu perfil", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Meu perfil" });
  await dialog.getByLabel("Nome de exibição").fill(name);
  await dialog.getByLabel(/Telefone/).fill("(21) 99999-9999");
  await dialog.getByRole("button", { name: "Salvar perfil" }).click();
  await dialog.getByText("Perfil atualizado.", { exact: true }).waitFor();
  await dialog.getByLabel("Confirme sua senha atual").fill(password);
  await dialog
    .getByRole("button", { name: "Vincular Google", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Continuar com o Google" }).click();
  await dialog.getByText("Vinculado a " + email, { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Fechar diálogo" }).click();
}
async function noOverflow(page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "A tela não deve rolar horizontalmente",
  );
}

async function main() {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "zen-google-browser-"));
  const mock = path.join(temp, "google.cjs");
  await fs.writeFile(
    mock,
    `
    const { OAuth2Client } = require(${JSON.stringify(require.resolve("google-auth-library"))});
    OAuth2Client.prototype.verifyIdToken = async function ({ idToken, audience }) {
      if (audience !== ${JSON.stringify(clientId)} || !/^fixture\\.[\\w-]+\\.simulada$/.test(idToken))
        throw Error("Credencial fora do teste local");
      const value = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
      return { getPayload: () => value };
    };
  `,
  );
  let ready = false;
  server = spawn(
    process.execPath,
    ["--require", mock, path.join(root, "scripts/homologation.cjs")],
    {
      cwd: root,
      env: {
        ...process.env,
        ZEN_HOMOLOGY_INSTANCE: instance,
        GOOGLE_CLIENT_ID: clientId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let startup = "";
  server.stdout.on("data", (chunk) => {
    startup = (startup + chunk).slice(-2400);
    ready ||= startup.includes("Homologação LOCAL pronta.");
  });
  server.stderr.on("data", (chunk) => {
    startup = (startup + chunk).slice(-2400);
  });
  await until(() => {
    if (server.exitCode !== null)
      throw Error(
        startup.replace(/Admin dos sistemas:.*/g, "[credencial omitida]"),
      );
    return ready;
  }, "A homologação local não iniciou.");
  const data = JSON.parse(
    await fs.readFile(path.join(directory, "access.json"), "utf8"),
  );
  const tech = data["1"];
  const technicalPassword = "Homolog1!Chat";
  const activation = await fetch("http://127.0.0.1:4317/api/auth/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      login: tech.login,
      password: tech.temporary_password,
      code: tech.activation_code,
      new_password: technicalPassword,
    }),
  });
  assert.ok(activation.ok, "Ativação local do técnico");
  const launch = { headless: true };
  if (process.env.ZEN_CHROMIUM_MODULE) {
    const module = (await import(process.env.ZEN_CHROMIUM_MODULE)).default;
    launch.args = module.args.filter(
      (arg) =>
        ![
          "--single-process",
          "--disable-web-security",
          "--disable-site-isolation-trials",
        ].includes(arg),
    );
    launch.executablePath = await module.executablePath();
  }
  if (process.env.ZEN_CHROMIUM_PATH)
    launch.executablePath = process.env.ZEN_CHROMIUM_PATH;
  browser = await chromium.launch(launch);
  const staff = await pageFor("operacao", { width: 1440, height: 960 });
  await passwordLogin(staff, "admin", data.admin_password);
  await staff.getByRole("navigation", { name: "Acesso rápido" }).waitFor();
  await staff.screenshot({
    path: path.join(directory, "zen-tracking.png"),
    fullPage: true,
  });
  await profile(
    staff,
    "Operação local",
    data.admin_password,
    "operacao@example.test",
  );
  await staff.getByRole("button", { name: "Sair", exact: true }).click();
  await staff.getByRole("button", { name: "Continuar com o Google" }).click();
  await staff.getByRole("heading", { name: "Olá, Operação." }).waitFor();
  summary.googleCentral = "passed (provider mocked)";
  await staff.getByRole("button", { name: "Abrir Estoque Pro" }).click();
  await staff.getByRole("link", { name: "Meu perfil ZenTracking" }).click();
  const shared = staff.getByRole("dialog", { name: "Meu perfil" });
  await shared.getByLabel("Nome de exibição").waitFor();
  assert.equal(
    await shared.getByLabel("Nome de exibição").inputValue(),
    "Operação local",
  );
  await shared.getByRole("button", { name: "Fechar diálogo" }).click();
  summary.stockProfile = "passed";
  await staff
    .getByRole("navigation", { name: "Acesso rápido" })
    .getByRole("link", { name: /Conversas/ })
    .click();
  await staff
    .getByRole("heading", { name: "Conversas com técnicos" })
    .waitFor();
  await staff.getByRole("button", { name: new RegExp(tech.name) }).click();

  const mobile = await pageFor("tecnico", { width: 390, height: 844 });
  await passwordLogin(mobile, tech.login, technicalPassword);
  await mobile.waitForURL("http://127.0.0.1:4319/**");
  await profile(
    mobile,
    "Técnico de campo",
    technicalPassword,
    "tecnico@example.test",
  );
  await mobile.getByRole("button", { name: "Sair", exact: true }).click();
  await mobile.getByRole("button", { name: "Entrar no ZenTracking" }).click();
  await mobile.getByRole("button", { name: "Continuar com o Google" }).click();
  await mobile.waitForURL("http://127.0.0.1:4319/**");
  summary.googleField = "passed (provider mocked, redirected to ZenField)";
  await mobile
    .getByRole("button", { name: "Chat com a central", exact: true })
    .click();
  await mobile.getByText("Em tempo real", { exact: true }).waitFor();
  await staff.getByText("Em tempo real", { exact: true }).waitFor();
  await mobile
    .getByLabel("Mensagem", { exact: true })
    .fill("Cheguei ao atendimento fictício.");
  await mobile.getByRole("button", { name: "Enviar", exact: true }).click();
  await staff
    .getByText("Cheguei ao atendimento fictício.", { exact: true })
    .first()
    .waitFor({ timeout: 5000 });
  await staff
    .getByLabel("Mensagem", { exact: true })
    .fill("Central confirmou o recebimento.");
  await staff.getByRole("button", { name: "Enviar", exact: true }).click();
  await mobile
    .getByText("Central confirmou o recebimento.", { exact: true })
    .waitFor({ timeout: 5000 });
  await mobile.screenshot({
    path: path.join(directory, "zenfield-chat.png"),
    fullPage: true,
  });
  await staff.screenshot({
    path: path.join(directory, "zencontrol-chat.png"),
    fullPage: true,
  });
  await noOverflow(mobile);
  await mobile.setViewportSize({ width: 320, height: 720 });
  await noOverflow(mobile);
  await mobile.getByLabel("Aparência", { exact: true }).selectOption("dark");
  await mobile.reload();
  await mobile
    .getByRole("button", { name: "Chat com a central", exact: true })
    .click();
  await mobile
    .getByText("Central confirmou o recebimento.", { exact: true })
    .waitFor();
  assert.equal(await mobile.locator("html").getAttribute("data-theme"), "dark");
  await mobile
    .getByRole("button", { name: "Voltar ao início", exact: true })
    .waitFor();
  assert.equal(
    await mobile
      .getByRole("navigation", { name: "Áreas do portal" })
      .isVisible(),
    false,
  );
  await noOverflow(mobile);
  await mobile.screenshot({
    path: path.join(directory, "zenfield-chat-escuro.png"),
    fullPage: true,
  });
  summary.liveChatBothDirections = "passed";
  summary.mobile320And390 = "passed";
  summary.historyAndDarkMode = "passed";
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ...summary,
      javascriptErrors: errors,
      evidenceDirectory: directory,
    }),
  );
}

main()
  .catch(async (error) => {
    console.error(error.message);
    console.error(JSON.stringify({ googleResponses, errors }));
    for (const [index, page] of pages.entries()) {
      if (page.isClosed()) continue;
      const url = new URL(page.url());
      console.error(
        JSON.stringify({
          page: url.origin + url.pathname,
          alerts: await page.getByRole("alert").allTextContents(),
          googleLoaded: await page.evaluate(() =>
            Boolean(window.google?.accounts?.id),
          ),
        }),
      );
      await page
        .screenshot({
          path: path.join(directory, "portal-falha-" + index + ".png"),
        })
        .catch(() => {});
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    if (server && server.exitCode === null) server.kill("SIGINT");
    if (temp) await fs.rm(temp, { recursive: true, force: true });
  });
