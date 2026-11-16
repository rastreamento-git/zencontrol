// End-to-end synthetic SGA: browser -> central API -> worker -> PostgreSQL.
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { testDatabase } = require("../apps/api/test/helpers/database.cjs");
const { migrate } = require("../apps/api/scripts/migrate");
const { createApp } = require("../apps/api/src/app");
const { startWorker } = require("../apps/api/src/worker-loop");
const intake = require("../apps/api/src/sga-intake");
const d = require("../apps/api/src/domain");
const origin = "http://127.0.0.1:4337";
let db, api, sga, worker, browser, directory;
const errors = [],
  requests = [];
async function main() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "zen-sga-intake-ui-"));
  const day = d.today();
  sga = http
    .createServer(async (req, res) => {
      requests.push(req.url);
      let result = [];
      if (req.url === "/usuario/autenticar")
        result = { token_usuario: "synthetic-sga-token" };
      if (req.url === "/listar/classificacao-veiculo/todos")
        result = [
          { codigo: 42, descricao: "INSTALAÇÃO PENDENTE", situacao: "ATIVO" },
        ];
      if (req.url === "/listar/situacao/todos")
        result = [{ codigo_situacao: 1, descricao_situacao: "ATIVO" }];
      if (req.url === "/listar/alteracao-veiculos")
        result = [
          {
            codigo_alteracao: "fixture-1",
            codigo_veiculo: "901",
            nome_campo_tabela: "codigo_classificacao",
            valor_anterior: "41",
            valor_posterior: "42",
            data_alteracao: day + "T10:00:00-0300",
          },
        ];
      if (req.url === "/veiculo/buscar/901/id")
        result = {
          codigo_veiculo: "901",
          placa: "SGA0901",
          nome: "João de Teste",
          modelo: "Fiat Uno",
          cpf: "00000000000",
          codigo_associado: "1",
          codigo_situacao: "1",
          descricao_situacao: "ATIVO",
          codigo_classificacao: "42",
          futuro: { original: "não descartar" },
        };
      if (req.url === "/produto-vinculado-veiculo/listar/901")
        result = {
          codigo_veiculo: "901",
          produtos: [
            {
              codigo_produto: "2371",
              descricao: "Adesivo Perfurado",
              situacao: "ATIVO",
            },
            {
              codigo_produto: "88",
              descricao: "Assistência 24 horas",
              situacao: "ATIVO",
            },
          ],
        };
      if (req.url === "/buscar/situacao-financeira-veiculo/901")
        result = {
          codigo_veiculo: "901",
          placa: "SGA0901",
          situacao_financeira: "ADIMPLENTE",
        };
      if (req.url === "/associado/buscar/1/codigo")
        result = {
          codigo_associado: "1",
          descricao_situacao: "ATIVO",
          descricao_classificacao: "ASSOCIADO",
        };
      if (req.url === "/buscar/situacao-associado/00000000000")
        result = { codigo_associado: "1", descricao: "ATIVO" };
      req.resume();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
    })
    .listen(0, "127.0.0.1");
  await once(sga, "listening");
  db = await testDatabase();
  await migrate(db.pool);
  await db.pool.query(
    "INSERT INTO zc_technicians(name) VALUES('Técnico de teste')",
  );
  const app = createApp(db.pool, {
    NODE_ENV: "test",
    APP_PASSWORD: "Intake1!teste",
    SESSION_SECRET: "test-only-sga-intake-ui-secret-1234567890",
    ZEN_WEBHOOK_SECRET: "test-only-sga-intake-webhook-secret-1234567890",
    ZEN_DATA_DIR: directory,
    ZEN_PUBLIC_URL: origin,
    SGA_READ_ENABLED: "true",
    SGA_SCHEDULING_GUARD: "true",
    HINOVA_TOKEN_ASSOC: "synthetic",
    HINOVA_USER: "synthetic",
    HINOVA_PASS: "synthetic",
    HINOVA_API_URL: "http://127.0.0.1:" + sga.address().port,
  });
  await app.locals.ready();
  api = app.listen(4337, "127.0.0.1");
  await once(api, "listening");
  worker = startWorker(db.pool, app.locals.config, {
    execute: intake.runCycle,
    intervalMs: 100,
  });
  const launch = { headless: true, args: ["--no-sandbox"] };
  if (process.env.ZEN_CHROMIUM_MODULE) {
    const module = (await import(process.env.ZEN_CHROMIUM_MODULE)).default;
    launch.executablePath = await module.executablePath();
    launch.args = module.args.filter(
      (arg) =>
        ![
          "--single-process",
          "--disable-web-security",
          "--disable-site-isolation-trials",
        ].includes(arg),
    );
  } else if (process.env.ZEN_CHROMIUM_PATH)
    launch.executablePath = process.env.ZEN_CHROMIUM_PATH;
  browser = await chromium.launch(launch);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/zencontrol?area=imports");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page
    .getByLabel("Senha de acesso", { exact: true })
    .fill("Intake1!teste");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("navigation", { name: "Acesso rápido" }).waitFor();
  await page.goto(origin + "/zencontrol?area=imports");
  const region = page.getByRole("region", {
    name: "Instalações pendentes do SGA",
  });
  await region
    .getByLabel("Etapa no catálogo atual do SGA")
    .selectOption("classifications:42");
  await region.getByLabel("Horário diário (Brasília)").fill("18:00");
  await region.getByRole("button", { name: "Salvar configuração" }).click();
  await page.getByText("Configuração da coleta SGA salva.").waitFor();
  await region.getByLabel(/Confirmo a coleta/).check();
  await region
    .getByRole("button", { name: "Buscar pendências de hoje" })
    .click();
  await region.getByText("João de Teste", { exact: true }).waitFor();
  assert.equal(
    (await db.pool.query("SELECT count(*)::int n FROM zc_orders")).rows[0].n,
    0,
  );
  assert.equal(
    (await db.pool.query("SELECT count(*)::int n FROM zc_order_counters"))
      .rows[0].n,
    0,
  );
  await page.screenshot({
    path: path.join(directory, "sga-importacao-desktop.png"),
    fullPage: true,
  });
  await region.getByRole("button", { name: "Revisar e atribuir" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Revisar cadastro e atribuir ao técnico",
  });
  await dialog.getByText("Assistência 24 horas", { exact: true }).waitFor();
  await dialog.getByText("Adesivo Perfurado", { exact: true }).waitFor();
  await dialog
    .getByLabel("Técnico", { exact: true })
    .selectOption({ label: "Técnico de teste" });
  await dialog.getByLabel("Data e horário do atendimento").fill(day + "T15:00");
  await dialog.getByLabel("Base da OS").selectOption("HOT");
  await page.screenshot({
    path: path.join(directory, "sga-atribuir-desktop.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Atribuir e gerar OS" }).click();
  await page
    .getByRole("dialog", { name: "Ordem de serviço", exact: true })
    .waitFor();
  const orders = (await db.pool.query("SELECT * FROM zc_orders")).rows;
  assert.equal(orders.length, 1);
  assert.match(orders[0].id, /^\d{8}[0-9A-F]{3}$/);
  assert.equal(orders[0].sticker_discount_opt_in, true);
  assert.equal(
    orders[0].raw_legacy[0].original.vehicle.futuro.original,
    "não descartar",
  );
  await page
    .getByRole("button", { name: "Fechar diálogo", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Sem rolagem horizontal da página",
  );
  await page.screenshot({
    path: path.join(directory, "sga-importacao-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: "passed",
      directory,
      generated_orders: orders.length,
      external_reads: requests.length,
    }),
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    await worker?.stop();
    for (const server of [api, sga])
      if (server) await new Promise((resolve) => server.close(resolve));
    await db?.close();
  });
