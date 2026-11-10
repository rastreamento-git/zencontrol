// Executar apenas contra a homologação local iniciada por scripts/homologation.cjs.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash, randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const instance =
  process.env.ZEN_HOMOLOGY_INSTANCE ||
  "frontend-" + randomBytes(4).toString("hex");
if (instance && !/^[a-zA-Z0-9_-]{1,64}$/.test(instance))
  throw Error("Nome de instância inválido.");
const directory = path.join(
  root,
  ".homologation" + (instance ? "-" + instance : ""),
);
const results = [];
let browser, server;
async function api(port, endpoint, body, token) {
  const response = await fetch(`http://127.0.0.1:${port}/api${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.ok(response.ok, data.error || `HTTP ${response.status}`);
  return data;
}
async function until(test, message, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error(message);
}
async function check(name, run) {
  try {
    await run();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.message.split("\n")[0] });
  }
}
async function main() {
  let output = "";
  server = spawn(
    process.execPath,
    [path.join(root, "scripts/homologation.cjs")],
    {
      cwd: root,
      env: { ...process.env, ZEN_HOMOLOGY_INSTANCE: instance },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => {
    output += chunk;
  });
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  await until(
    () => {
      if (server.exitCode !== null)
        throw Error(
          output.replace(/Admin dos sistemas:.*/g, "[credencial omitida]"),
        );
      return output.includes("Homologação LOCAL pronta.");
    },
    "A homologação local não iniciou.",
    30000,
  );
  const credentials = JSON.parse(
    await fs.readFile(path.join(directory, "access.json"), "utf8"),
  );
  const centralToken = (
    await api(4317, "/auth/login", {
      login: "admin",
      password: credentials.admin_password,
      audience: "ecosystem",
    })
  ).token;
  async function tokenFor(app, port) {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(24).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const ticket = await api(
      4317,
      "/auth/sso/code",
      { app, state, challenge },
      centralToken,
    );
    const code = new URLSearchParams(
      new URL(ticket.redirect_url).hash.slice(1),
    ).get("zen_code");
    return (
      await api(port, "/auth/sso/exchange", { app, state, code, verifier })
    ).token;
  }
  const launch = { headless: true };
  if (process.env.ZEN_CHROMIUM_MODULE) {
    const module = (await import(process.env.ZEN_CHROMIUM_MODULE)).default;
    launch.args = module.args.filter((arg) => arg !== "--single-process");
    launch.executablePath = await module.executablePath();
  }
  if (process.env.ZEN_CHROMIUM_PATH)
    launch.executablePath = process.env.ZEN_CHROMIUM_PATH;
  browser = await chromium.launch(launch);
  const pageErrors = [];
  async function pageFor(port, token, key, suffix = "") {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    });
    await context.addInitScript(
      ({ token, key, origin }) => {
        if (location.origin === origin) sessionStorage.setItem(key, token);
      },
      { token, key, origin: `http://127.0.0.1:${port}` },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}${suffix}`);
    return page;
  }
  async function finance() {
    const page = await pageFor(
      4320,
      centralToken,
      "zencontrol.session",
      "/zencontrol",
    );
    await page.getByRole("button", { name: "Financeiro", exact: true }).click();
    await page.getByLabel("Técnico", { exact: true }).waitFor();
    return page;
  }
  const fieldToken = await tokenFor("zenfield", 4317);
  async function field() {
    const page = await pageFor(4319, fieldToken, "zenfield.session");
    await page
      .getByRole("button", {
        name: "Acessar ambiente de José da Silva Martins",
        exact: true,
      })
      .click();
    await page
      .getByRole("heading", { name: "Seu dia em campo", exact: true })
      .waitFor();
    return page;
  }

  await check(
    "Tarifa de resposta atrasada não substitui o técnico atual",
    async () => {
      const page = await finance();
      let release,
        started = false;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      await page.route("**/finance-v2/technicians/*/rates", async (route) => {
        const old = new URL(route.request().url()).pathname.includes(
          "/1/rates",
        );
        if (old) {
          started = true;
          await gate;
        }
        try {
          await route.fulfill({
            json: {
              items: [
                {
                  effective_on: "2020-01-01",
                  prices: {
                    Instalação: old ? 10000 : 20000,
                  },
                },
              ],
            },
          });
        } catch {
          /* A requisição cancelada já não tem consumidor. */
        }
      });
      await page.getByLabel("Técnico", { exact: true }).selectOption("1");
      await until(() => started, "A consulta de tarifas não iniciou.");
      await page.getByLabel("Técnico", { exact: true }).selectOption("2");
      await page
        .getByText("Política de fechamento e tarifas", { exact: true })
        .click();
      const price = page.getByLabel("Instalação (R$)", { exact: true });
      await until(
        async () => (await price.inputValue().catch(() => "")) === "200",
        "Tarifa do segundo técnico não carregou.",
      );
      release();
      await page.waitForTimeout(250);
      assert.equal(await price.inputValue(), "200");
      await page.context().close();
    },
  );
  await check(
    "Troca de técnico encerra o formulário de pagamento anterior",
    async () => {
      const page = await finance();
      await page.getByLabel("Técnico", { exact: true }).selectOption("1");
      await page
        .getByRole("button", {
          name: "Registrar pagamento externo",
          exact: true,
        })
        .first()
        .click();
      await page
        .getByRole("heading", {
          name: "Registrar pagamento já efetuado",
          exact: true,
        })
        .waitFor();
      await Promise.all([
        page.waitForResponse(
          (r) => new URL(r.url()).pathname === "/api/finance-v2/technicians/2",
        ),
        page.getByLabel("Técnico", { exact: true }).selectOption("2"),
      ]);
      await page.waitForTimeout(100);
      assert.equal(
        await page
          .getByRole("heading", {
            name: "Registrar pagamento já efetuado",
            exact: true,
          })
          .count(),
        0,
      );
      await page.context().close();
    },
  );
  await check(
    "Falha nos atendimentos aparece na página inicial do ZenField",
    async () => {
      const page = await pageFor(4319, fieldToken, "zenfield.session");
      await page.route("**/technician/orders?**", (route) =>
        route.fulfill({
          status: 503,
          json: { error: "Falha simulada nos atendimentos" },
        }),
      );
      await page
        .getByRole("button", {
          name: "Acessar ambiente de José da Silva Martins",
          exact: true,
        })
        .click();
      await page
        .getByRole("heading", { name: "Seu dia em campo", exact: true })
        .waitFor();
      await until(
        async () =>
          await page
            .getByRole("alert")
            .filter({ hasText: "Falha simulada nos atendimentos" })
            .isVisible(),
        "A falha ficou oculta na página inicial.",
      );
      await page
        .getByRole("button", { name: "Tentar novamente", exact: true })
        .waitFor();
      await page.context().close();
    },
  );
  await check(
    "Filtros de serviços não limitam o resumo inicial do ZenField",
    async () => {
      const page = await field();
      await page
        .getByRole("button", { name: "Meus serviços", exact: true })
        .click();
      await page
        .getByText("Filtrar serviços", { exact: false })
        .first()
        .click();
      await page
        .getByLabel("Número da OS", { exact: true })
        .fill("NAO-EXISTE-FILTRO");
      await page
        .getByText("Nenhum serviço nesta lista", { exact: true })
        .waitFor();
      const [request] = await Promise.all([
        page.waitForRequest((r) => r.url().includes("/technician/orders?")),
        page.getByRole("button", { name: "Início", exact: true }).click(),
      ]);
      const params = new URL(request.url()).searchParams;
      assert.ok(!params.get("q"), "A página inicial herdou o filtro de OS.");
      assert.equal(params.get("page"), "1");
      await page.context().close();
    },
  );
  await check(
    "Busca global do estoque limpa filtros mesmo repetindo o termo",
    async () => {
      const token = await tokenFor("stock", 4318);
      const page = await pageFor(4321, token, "invent.session");
      await page
        .getByRole("heading", { name: "Visão do estoque", exact: true })
        .waitFor();
      const size = page.viewportSize();
      await page.setViewportSize({ width: 320, height: 720 });
      const quickActions = page.getByRole("group", {
        name: "Ações rápidas do estoque",
      });
      assert.ok(
        await quickActions
          .getByRole("button", { name: /Registrar entrada/ })
          .isVisible(),
      );
      assert.ok(
        await quickActions
          .getByRole("button", { name: /Rastrear IMEI ou serial/ })
          .isVisible(),
      );
      await page.screenshot({
        path: path.join(directory, "estoque-mobile.png"),
      });
      await page.setViewportSize(size);
      await page
        .getByRole("group", { name: "Ações rápidas do estoque" })
        .getByRole("button", { name: /Rastrear IMEI ou serial/ })
        .click();
      const globalSearch = page.getByLabel(
        "Pesquisar equipamento ou digitar atalho",
        { exact: true },
      );
      const traceSearch = page.getByLabel(
        "Buscar equipamentos na rastreabilidade",
        { exact: true },
      );
      await traceSearch.waitFor();
      assert.equal(await globalSearch.count(), 0);
      for (let attempt = 0; attempt < 2; attempt++) {
        await page
          .getByLabel("Status", { exact: true })
          .selectOption("INSTALADO");
        await page
          .getByRole("button", { name: "Painel de controle", exact: true })
          .click();
        await globalSearch.fill("123456789012345");
        await page
          .getByRole("button", {
            name: "Executar pesquisa ou atalho",
            exact: true,
          })
          .click();
        await until(
          async () => (await traceSearch.inputValue()) === "123456789012345",
          "A pesquisa global deve abrir a rastreabilidade com o IMEI.",
        );
        assert.equal(
          await page.getByLabel("Status", { exact: true }).inputValue(),
          "TODOS",
        );
        assert.equal(await globalSearch.count(), 0);
      }
      await page.context().close();
    },
  );
  await check(
    "Equipe unificada cadastra pessoas por perfil e preserva o acesso do técnico ao editar o cadastro",
    async () => {
      const page = await pageFor(
        4320,
        centralToken,
        "zencontrol.session",
        "/zencontrol",
      );
      try {
        await page
          .getByRole("button", { name: "Equipe e acessos", exact: true })
          .click();
        assert.equal(
          await page
            .getByRole("button", { name: "Equipe técnica", exact: true })
            .count(),
          0,
        );
        const search = page.getByRole("searchbox", { name: "Buscar pessoa" });
        await search.fill("jose");
        const techs = page.getByRole("region", {
          name: "Técnicos",
          exact: true,
        });
        await techs
          .getByText("Usuário: jose.martins", { exact: true })
          .waitFor();
        assert.equal(await techs.getByRole("listitem").count(), 1);
        await search.clear();

        async function chooseProfile(profile) {
          await page
            .getByRole("button", { name: "Adicionar pessoa", exact: true })
            .click();
          await page
            .getByRole("dialog", { name: "Adicionar pessoa" })
            .getByRole("button", { name: new RegExp("^" + profile + " ") })
            .click();
        }
        await chooseProfile("Operador");
        const operator = page.getByRole("dialog", { name: "Novo operador" });
        await operator.getByLabel("Nome de exibição").fill("Operador de teste");
        await operator
          .getByLabel("Usuário", { exact: true })
          .fill("operador.qa");
        await operator.getByLabel("Senha inicial").fill("Operador1!qa");
        assert.equal(
          await operator.getByLabel("Cadastro técnico vinculado").count(),
          0,
        );
        await operator
          .getByRole("button", { name: "Salvar", exact: true })
          .click();
        await page
          .getByRole("region", { name: "Operadores", exact: true })
          .getByText("Usuário: operador.qa", { exact: true })
          .waitFor();

        await chooseProfile("Técnico");
        const techForm = page.getByRole("dialog", {
          name: "Cadastrar técnico",
        });
        await techForm
          .getByLabel("Nome", { exact: true })
          .fill("Técnica de teste");
        await techForm
          .getByLabel("Instalação (R$)", { exact: true })
          .fill("95");
        await techForm
          .getByRole("button", { name: "Salvar", exact: true })
          .click();
        const activation = page.getByRole("dialog", {
          name: "Primeiro acesso ao ZenField",
        });
        await activation
          .getByText("Senha temporária", { exact: true })
          .waitFor();
        assert.ok((await activation.locator("code").textContent()).trim());
        await activation
          .getByRole("button", { name: "Concluir", exact: true })
          .click();
        const row = techs
          .getByRole("listitem")
          .filter({ hasText: "Usuário: tecnica.teste" });
        await row
          .getByRole("button", { name: "Acesso ZenField", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "Acesso ao ZenField" })
          .getByRole("button", { name: "Editar acesso", exact: true })
          .click();
        const access = page.getByRole("dialog", { name: "Editar acesso" });
        await access.getByLabel("Acesso habilitado").uncheck();
        await access
          .getByRole("button", { name: "Salvar", exact: true })
          .click();
        await row.getByText("Desativado", { exact: true }).waitFor();
        await row
          .getByRole("button", { name: "Editar cadastro", exact: true })
          .click();
        const cadastro = page.getByRole("dialog", {
          name: "Editar cadastro técnico",
        });
        await cadastro
          .getByLabel("Endereço / região base", { exact: true })
          .fill("Niterói");
        await cadastro
          .getByRole("button", { name: "Salvar", exact: true })
          .click();
        await row.getByText("Niterói", { exact: true }).waitFor();
        await page.getByLabel("Status do acesso").selectOption("inactive");
        await row.getByText("Desativado", { exact: true }).waitFor();
        assert.equal(await techs.getByRole("listitem").count(), 1);
        await page.setViewportSize({ width: 320, height: 760 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          "Equipe e acessos deve caber na largura do celular.",
        );
        assert.ok(
          await page.evaluate(() => {
            const title = document
              .querySelector(".topbar h1")
              .getBoundingClientRect();
            const actions = document
              .querySelector(".topbar-actions")
              .getBoundingClientRect();
            return (
              title.right <= actions.left + 1 || title.bottom <= actions.top + 1
            );
          }),
          "Os botões do cabeçalho não devem sobrepor o título.",
        );
      } finally {
        await page.context().close();
      }
    },
  );
  await check("Menu móvel do ZenControl fecha com Escape", async () => {
    const page = await pageFor(
      4320,
      centralToken,
      "zencontrol.session",
      "/zencontrol",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.getByRole("button", { name: "Abrir menu", exact: true });
    await menu.click();
    assert.equal(await menu.getAttribute("aria-expanded"), "true");
    await page.keyboard.press("Escape");
    assert.equal(await menu.getAttribute("aria-expanded"), "false");
    await page.context().close();
  });
  assert.deepEqual(pageErrors, [], "Erros de execução no navegador");
  console.log(JSON.stringify({ results, pageErrors }, null, 2));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    if (server && server.exitCode === null) {
      server.kill("SIGINT");
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          server.kill("SIGKILL");
          resolve();
        }, 5000);
        server.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  });
