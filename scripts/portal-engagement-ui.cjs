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
  const mailbox = path.join(temp, "test-mail.jsonl");
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
    const realFetch = globalThis.fetch;
    globalThis.fetch = (url, options) => {
      if (url !== "https://api.resend.com/emails") return realFetch(url, options);
      require("node:fs").appendFileSync(${JSON.stringify(mailbox)}, options.body + "\\n", { mode: 0o600 });
      return Promise.resolve(new Response(null, { status: 200 }));
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
        RESEND_API_KEY: "browser-test-only",
        PASSWORD_RESET_FROM: "contas@example.test",
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
  const localApi = "http://127.0.0.1:4317/api";
  const operatorLogin = "marcele.teste",
    operatorPassword = "Homolog1!Operacao";
  const adminLogin = await fetch(localApi + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      login: "admin",
      password: data.admin_password,
      audience: "ecosystem",
    }),
  });
  assert.ok(adminLogin.ok, "Login do administrador fictício");
  const operatorAccount = await fetch(localApi + "/users", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + (await adminLogin.json()).token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      login: operatorLogin,
      nome: "Marcele",
      password: operatorPassword,
      papel: "operador",
      recovery_email: "marcele@example.test",
    }),
  });
  assert.ok(operatorAccount.ok, "Cadastro da operadora fictícia");
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
  const legacyDirectory = (url) => url.pathname === "/api/chat/threads";
  const missingTeam = (url) => url.pathname === "/api/chat/team";
  await staff.route(legacyDirectory, (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await staff.route(missingTeam, (route) =>
    route.fulfill({ status: 404, json: { error: "Rota não encontrada." } }),
  );
  await staff
    .getByRole("navigation", { name: "Acesso rápido" })
    .getByRole("link", { name: /Conversas/ })
    .click();
  const staffChat = staff.getByRole("dialog", {
    name: "Conversas da operação",
  });
  await staffChat.waitFor();
  assert.ok(await staffChat.evaluate((dialog) => dialog.matches(":modal")));
  const updateWarning = staffChat
    .getByRole("alert")
    .getByText(
      "A API do ZenControl deste ambiente precisa ser atualizada para carregar o chat.",
    );
  await updateWarning.waitFor();
  assert.equal(
    await staffChat.getByText("Em tempo real", { exact: true }).count(),
    0,
  );
  assert.equal(
    await staffChat.getByText("Nenhum técnico ativo cadastrado.").count(),
    0,
  );
  await staffChat.getByRole("button", { name: "Equipe interna" }).click();
  await updateWarning.waitFor();
  await staff.unroute(missingTeam);
  await staffChat.getByRole("button", { name: "Tentar novamente" }).click();
  await staffChat
    .getByRole("heading", { name: "Sala da operação", exact: true })
    .waitFor();
  await staffChat.getByText("Operação local", { exact: true }).waitFor();
  await staffChat.getByText("Marcele", { exact: true }).waitFor();
  await staff.unroute(legacyDirectory);
  await staffChat
    .getByRole("button", { name: "Técnicos", exact: true })
    .click();
  assert.ok(
    await staffChat
      .getByRole("button", {
        name: /Maria.*Offline.*Recebe ao primeiro acesso/,
      })
      .isEnabled(),
  );
  await staffChat.getByRole("button", { name: new RegExp(tech.name) }).click();
  const staffDraft = staffChat.getByLabel("Mensagem", { exact: true });
  await staffDraft.fill("Central confirmou o recebimento.");
  await staffChat.getByRole("button", { name: "Voltar ao mini chat" }).click();
  assert.ok(!(await staffChat.evaluate((dialog) => dialog.matches(":modal"))));
  const miniBounds = await staffChat.boundingBox();
  assert.ok(miniBounds && miniBounds.x > staff.viewportSize().width / 2);
  await staff
    .getByRole("button", { name: "Ordens de serviço", exact: true })
    .click();
  await staff
    .getByRole("navigation", { name: "Visualização dos serviços" })
    .getByRole("button", { name: "Agenda", exact: true })
    .click();
  await staff
    .getByRole("heading", { name: "Agenda", exact: true })
    .first()
    .waitFor();
  await staff.screenshot({
    path: path.join(directory, "zencontrol-mini-chat.png"),
    fullPage: true,
  });
  await staffChat
    .getByRole("button", { name: "Abrir chat em tela cheia" })
    .click();
  assert.equal(
    await staffDraft.inputValue(),
    "Central confirmou o recebimento.",
  );
  await staffChat.getByText("Em tempo real", { exact: true }).waitFor();
  await staffChat.getByRole("button", { name: "Voltar ao mini chat" }).click();
  await staffChat
    .getByRole("button", { name: "Voltar aos técnicos", exact: true })
    .click();
  await staffChat.getByLabel("Buscar técnico nas conversas").fill(tech.name);
  await staffChat.getByRole("button", { name: new RegExp(tech.name) }).click();
  const outreach = "Confirme o recebimento do atendimento fictício.";
  await staffChat.getByLabel("Mensagem", { exact: true }).fill(outreach);
  await staffChat.getByRole("button", { name: "Enviar", exact: true }).click();
  await staffChat
    .getByRole("log", { name: "Histórico de mensagens" })
    .getByText(outreach)
    .waitFor();
  await staffChat.getByRole("button", { name: "Fechar chat" }).click();

  const operatorPage = await pageFor("marcele", { width: 1280, height: 820 });
  await passwordLogin(operatorPage, operatorLogin, operatorPassword);
  await operatorPage.getByRole("button", { name: "Abrir ZenControl" }).click();
  await operatorPage
    .getByRole("button", { name: "Meu perfil", exact: true })
    .click();
  const operatorProfile = operatorPage.getByRole("dialog", {
    name: "Meu perfil",
  });
  await operatorProfile
    .getByLabel("Foto de perfil")
    .setInputFiles(
      path.join(directory, "fixtures", "foto-vistoria-exemplo.jpg"),
    );
  await operatorProfile.getByText("Foto de perfil atualizada.").waitFor();
  await operatorProfile.locator(".zen-person-avatar img").waitFor();
  await operatorProfile.getByRole("button", { name: "Fechar diálogo" }).click();

  const mobile = await pageFor("tecnico", { width: 390, height: 844 });
  await passwordLogin(mobile, tech.login, tech.temporary_password);
  await mobile
    .getByRole("heading", { name: "Defina sua primeira senha" })
    .waitFor();
  await mobile
    .getByLabel("Nova senha", { exact: true })
    .fill(technicalPassword);
  await mobile
    .getByLabel("Confirme a nova senha", { exact: true })
    .fill(technicalPassword);
  await mobile.getByRole("button", { name: "Salvar nova senha" }).click();
  await mobile
    .getByText("Senha definida. Entre com sua nova senha.", { exact: true })
    .waitFor();
  await mobile
    .getByLabel("Senha de acesso", { exact: true })
    .fill(technicalPassword);
  await mobile.getByRole("button", { name: "Entrar", exact: true }).click();
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
  const fieldNav = mobile.getByRole("navigation", { name: "Áreas do portal" });
  await fieldNav
    .getByRole("button", { name: "Meus serviços", exact: true })
    .click();
  await mobile
    .getByRole("heading", { name: "Meus serviços", exact: true })
    .waitFor();
  await mobile.locator(".portal-order").first().click();
  const openService = mobile.locator(".portal-service");
  await openService.waitFor();
  const fieldNotice = mobile.getByRole("button", {
    name: /Notificações, [1-9]\d* não lidas/,
  });
  await fieldNotice.click();
  await mobile
    .getByRole("region", { name: "Histórico de notificações" })
    .getByRole("button", { name: /Nova mensagem da central/ })
    .click();
  const fieldChat = mobile.getByRole("dialog", { name: "Chat com a central" });
  await fieldChat.getByText(outreach, { exact: true }).waitFor();
  await fieldChat.getByText("Em tempo real", { exact: true }).waitFor();
  await fieldChat.getByLabel("Meu status").selectOption("busy");
  const fieldDraft = fieldChat.getByLabel("Mensagem", { exact: true });
  await fieldDraft.fill("Cheguei ao atendimento fictício.");
  await fieldChat.getByRole("button", { name: "Voltar ao mini chat" }).click();
  const fieldMini = await fieldChat.boundingBox();
  const navBounds = await fieldNav.boundingBox();
  assert.ok(
    fieldMini && navBounds && fieldMini.y + fieldMini.height <= navBounds.y,
  );
  assert.equal(
    await fieldDraft.inputValue(),
    "Cheguei ao atendimento fictício.",
  );
  await fieldChat.getByRole("button", { name: "Enviar", exact: true }).click();
  await Promise.all(
    [staff, operatorPage].map((page) =>
      page
        .getByText("Nova mensagem na caixa da operação.", { exact: true })
        .waitFor({ timeout: 5000 }),
    ),
  );
  const notice = operatorPage.getByRole("button", {
    name: /Notificações, [1-9]\d* não lidas/,
  });
  await notice.click();
  await operatorPage
    .getByRole("region", { name: "Histórico de notificações" })
    .getByRole("button", { name: /Nova mensagem de técnico/ })
    .click();
  const operatorChat = operatorPage.getByRole("dialog", {
    name: "Conversas da operação",
  });
  await operatorChat
    .getByRole("heading", { name: tech.name, exact: true })
    .waitFor();
  await operatorChat
    .getByRole("log", { name: "Histórico de mensagens" })
    .getByText("Cheguei ao atendimento fictício.", { exact: true })
    .waitFor();
  await operatorChat
    .getByRole("button", { name: new RegExp(tech.name) })
    .getByText("Ocupado", { exact: true })
    .waitFor();
  await operatorChat
    .getByLabel("Mensagem", { exact: true })
    .fill("Central confirmou o recebimento.");
  await fieldChat.getByRole("button", { name: "Fechar chat" }).click();
  await operatorChat
    .getByRole("button", { name: "Enviar", exact: true })
    .click();
  await mobile
    .getByText("Nova mensagem da central.", { exact: true })
    .waitFor({ timeout: 5000 });
  await fieldNotice.click();
  await mobile
    .getByRole("region", { name: "Histórico de notificações" })
    .getByRole("button", { name: /Nova mensagem da central.*Marcele/ })
    .click();
  await fieldChat
    .getByText("Central confirmou o recebimento.", { exact: true })
    .waitFor({ timeout: 5000 });
  const reply = fieldChat
    .locator(".zen-chat-messages li")
    .filter({ hasText: "Central confirmou o recebimento." });
  await reply.getByText("Marcele", { exact: true }).waitFor();
  await reply.getByText("Operador", { exact: true }).waitFor();
  await reply.locator(".zen-person-avatar img").waitFor();
  await operatorPage.screenshot({
    path: path.join(directory, "zencontrol-chat.png"),
  });

  await operatorChat
    .getByRole("button", { name: "Equipe interna", exact: true })
    .click();
  await operatorChat.getByText(/^Colaboradores \(/).waitFor();
  await operatorChat.getByText("Operação local", { exact: true }).waitFor();
  await operatorChat
    .getByRole("heading", { name: "Sala da operação", exact: true })
    .waitFor();
  await operatorChat
    .getByRole("button", { name: "Voltar ao mini chat" })
    .click();
  assert.ok(
    await operatorChat.getByText("Operação local", { exact: true }).isVisible(),
  );
  await operatorChat
    .getByLabel("Mensagem", { exact: true })
    .fill("Mensagem interna fictícia");
  await operatorChat
    .getByRole("button", { name: "Enviar", exact: true })
    .click();
  await staff.getByRole("button", { name: "Conversas", exact: true }).click();
  await staffChat
    .getByRole("button", { name: "Equipe interna", exact: true })
    .click();
  await staffChat
    .getByText("Mensagem interna fictícia", { exact: true })
    .waitFor();
  assert.equal(
    await fieldChat
      .getByText("Mensagem interna fictícia", { exact: true })
      .count(),
    0,
  );
  await fieldChat.getByRole("button", { name: "Fechar chat" }).click();
  await openService.waitFor();
  await mobile.getByRole("button", { name: "Mini chat", exact: true }).click();
  await fieldChat
    .getByRole("button", { name: "Abrir chat em tela cheia" })
    .click();
  await mobile.screenshot({
    path: path.join(directory, "zenfield-chat.png"),
  });
  await noOverflow(mobile);
  await mobile.keyboard.press("Escape");
  await fieldChat.waitFor({ state: "hidden" });
  await mobile.setViewportSize({ width: 320, height: 568 });
  await noOverflow(mobile);
  await mobile.getByLabel("Aparência", { exact: true }).selectOption("dark");
  await mobile.reload();
  await fieldNav
    .getByRole("button", { name: "Chat com a central", exact: true })
    .click();
  await fieldChat
    .getByText("Central confirmou o recebimento.", { exact: true })
    .waitFor();
  assert.equal(await mobile.locator("html").getAttribute("data-theme"), "dark");
  assert.ok(await fieldChat.evaluate((dialog) => dialog.matches(":modal")));
  await noOverflow(mobile);
  const composerBounds = await fieldChat
    .locator(".zen-chat-compose")
    .boundingBox();
  const sendBounds = await fieldChat
    .getByRole("button", { name: "Enviar", exact: true })
    .boundingBox();
  assert.ok(
    composerBounds &&
      sendBounds &&
      sendBounds.x + sendBounds.width <=
        composerBounds.x + composerBounds.width + 1 &&
      sendBounds.y + sendBounds.height <= mobile.viewportSize().height,
    "O botão Enviar deve caber inteiro dentro da conversa a 320 px",
  );
  await mobile.screenshot({
    path: path.join(directory, "zenfield-chat-escuro.png"),
  });
  await fieldChat.getByRole("button", { name: "Voltar ao mini chat" }).click();
  await mobile.setViewportSize({ width: 320, height: 400 });
  const shortScreenSend = await fieldChat
    .getByRole("button", { name: "Enviar", exact: true })
    .boundingBox();
  assert.ok(
    shortScreenSend &&
      shortScreenSend.y + shortScreenSend.height <=
        mobile.viewportSize().height,
    "O botão Enviar do mini chat deve caber em uma tela de 400 px de altura",
  );
  summary.chatModesAndDrafts = "passed";
  summary.liveChatBothDirections = "passed";
  summary.sharedInboxAndPrivateStaffRoom = "passed";
  summary.presenceAndPhoto = "passed";
  const recoveryPage = await pageFor("recovery", { width: 390, height: 844 });
  await recoveryPage.goto(hub);
  await recoveryPage
    .getByRole("button", { name: "Esqueci minha senha" })
    .click();
  await recoveryPage
    .getByLabel("Usuário ou e-mail cadastrado")
    .fill("marcele@example.test");
  await recoveryPage.getByRole("button", { name: "Enviar link" }).click();
  await recoveryPage.getByText(/Se houver uma conta ativa/).waitFor();
  let mail;
  await until(async () => {
    try {
      const lines = (await fs.readFile(mailbox, "utf8")).trim().split("\n");
      mail = JSON.parse(lines[0]);
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return false;
    }
  }, "A recuperação não chegou à caixa de e-mail simulada.");
  assert.deepEqual(mail.to, ["marcele@example.test"]);
  const url = new URL(mail.text.split("\n\n").at(-1));
  assert.equal(url.origin, hub);
  await recoveryPage.goto(url.href);
  await recoveryPage
    .getByRole("heading", { name: "Redefina sua senha" })
    .waitFor();
  assert.equal(new URL(recoveryPage.url()).hash, "");
  const resetPassword = "Redefinida1!Operacao";
  await recoveryPage
    .getByLabel("Nova senha", { exact: true })
    .fill(resetPassword);
  await recoveryPage
    .getByLabel("Confirme a nova senha", { exact: true })
    .fill(resetPassword);
  await recoveryPage.getByRole("button", { name: "Salvar nova senha" }).click();
  await recoveryPage
    .getByText("Senha definida. Entre com sua nova senha.")
    .waitFor();
  await recoveryPage.getByLabel("Usuário", { exact: true }).fill(operatorLogin);
  await recoveryPage
    .getByLabel("Senha de acesso", { exact: true })
    .fill(resetPassword);
  await recoveryPage
    .getByRole("button", { name: "Entrar", exact: true })
    .click();
  await recoveryPage
    .getByRole("button", { name: "Abrir ZenControl" })
    .waitFor();
  summary.firstAccessRecoveryAndProactiveChat = "passed";
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
