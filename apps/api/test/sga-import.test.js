const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { once } = require("node:events");
const ExcelJS = require("exceljs");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const { createApp } = require("../src/app");
const { completeRow } = require("../src/sga-enrichment");
const { type } = require("../src/spreadsheet-import");
for (const cancel of [false, true, "skip", "skip-schedule"])
  test(
    typeof cancel === "string"
      ? "importação pode adiar consulta SGA para as OS sem requisições externas"
      : cancel
        ? "administrador interrompe SGA lento e confirma prévia sem alterações posteriores do worker"
        : "SGA consulta em segundo plano, completa origem importada e usa catálogos atuais sem escrita externa",
    async () => {
      const db = await testDatabase();
      let appServer, sgaServer, release;
      const calls = [];
      const gate = new Promise((resolve) => (release = resolve));
      try {
        await migrate(db.pool);
        sgaServer = createServer(async (req, res) => {
          calls.push({ path: req.url, method: req.method });
          res.setHeader("content-type", "application/json");
          let result = [];
          if (req.url === "/usuario/autenticar")
            result = { token_usuario: "TEST-TOKEN" };
          else if (req.url === "/listar/classificacao-veiculo/todos")
            result = [
              {
                codigo: "1",
                descricao: "Nome atual vindo da API",
                situacao: "ATIVO",
              },
            ];
          else if (req.url === "/listar/situacao/todos")
            result = [
              {
                codigo_situacao: "99",
                descricao_situacao: "Situação atual",
                situacao: "ATIVO",
              },
            ];
          else if (req.url === "/listar/marca/todos")
            result = [{ codigo_marca: "7", descricao_marca: "Marca atual" }];
          else if (req.url === "/listar/cor/todos")
            result = [{ codigo_cor: "8", descricao_cor: "Cor atual" }];
          else if (req.url === "/listar/tipo-veiculo/todos")
            result = [{ codigo_tipo: "3", descricao_tipo: "AUTOMÓVEL" }];
          else if (req.url === "/veiculo/buscar/ABC1D23/placa") {
            await gate;
            result = [
              {
                codigo_veiculo: 42,
                placa: "ABC1D23",
                nome: "Associado de teste",
              },
            ];
          } else if (req.url === "/veiculo/buscar/42/id")
            result = {
              codigo_veiculo: 42,
              placa: "ABC1D23",
              nome: "Associado de teste",
              codigo_classificacao: 1,
              codigo_situacao: 99,
              codigo_marca: 7,
              codigo_cor: 8,
              codigo_tipo_veiculo: 3,
              modelo: "Modelo atual",
              cpf: "00000000000",
              telefone: "21999990000",
              logradouro: "Rua fictícia",
              numero: "10",
              cidade: "Niterói",
              estado: "RJ",
              valor_fipe: "35000",
              senha: "DO-NOT-COPY",
            };
          res.end(JSON.stringify(result));
        }).listen(0, "127.0.0.1");
        await once(sgaServer, "listening");
        const password = "SgaTeste1!Senha";
        const app = createApp(db.pool, {
          APP_PASSWORD: password,
          SESSION_SECRET: "sga-test-session-secret-123456789012345",
          ZEN_WEBHOOK_SECRET: "sga-test-webhook-secret-123456789012345",
          SGA_READ_ENABLED: "true",
          INTEGRATIONS_ENABLED: "false",
          HINOVA_API_URL: "http://127.0.0.1:" + sgaServer.address().port,
          HINOVA_USER: "teste",
          HINOVA_PASS: "test-only",
          HINOVA_TOKEN_ASSOC: "test-only-token",
        });
        await app.locals.ready();
        appServer = app.listen(0, "127.0.0.1");
        await once(appServer, "listening");
        const base = "http://127.0.0.1:" + appServer.address().port;
        const login = await fetch(base + "/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ login: "admin", password }),
        }).then((r) => r.json());
        const call = async (path, body, contentType = "application/json") => {
          const r = await fetch(base + path, {
            method: body ? "POST" : "GET",
            headers: {
              Authorization: "Bearer " + login.token,
              "content-type": contentType,
            },
            body: body ? JSON.stringify(body) : undefined,
          });
          return { status: r.status, data: await r.json() };
        };
        const deferred = typeof cancel === "string",
          schedule = cancel === "skip-schedule";
        if (schedule)
          await db.pool.query(
            "INSERT INTO zc_technicians(name) VALUES('Técnico agenda')",
          );
        const w = new ExcelJS.Workbook(),
          sheet = w.addWorksheet("NOVEMBRO 2026");
        sheet.addRow([
          "",
          "SERVIÇO",
          "NOME DO ASSOCIADO",
          "PLACA / CHASSI",
          "IMEI",
          "DATA DE ENVIO DO TERMO",
          "DATA DE CONCLUSÃO",
          "TÉCNICO",
          "",
          "",
          "",
          "",
          "",
          "",
          "SITUAÇÃO",
        ]);
        sheet.addRow([
          "",
          "Instalação",
          cancel ? "Associado da planilha" : "",
          "ABC1D23",
          "000007260510340",
          "",
          "02/11/2026",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "CONCLUÍDO",
        ]);
        if (schedule) {
          sheet.getCell("P1").value = "AGENDAMENTO";
          sheet.getCell("G2").value = "";
          sheet.getCell("H2").value = "Técnico agenda";
          sheet.getCell("O2").value = "AGENDADO";
          sheet.getCell("P2").value = "14/11/2026";
        }
        const upload = await call(
          "/api/spreadsheet-imports",
          {
            filename: "controle.xlsx",
            content: Buffer.from(await w.xlsx.writeBuffer()).toString("base64"),
          },
          type,
        );
        const path = "/api/spreadsheet-imports/" + upload.data.id;
        const reviewed = await call(path + "/review", {
          sheets: ["NOVEMBRO 2026"],
          archive: "COLD",
          sga_mode: deferred ? "skip" : "fill_missing",
        });
        assert.equal(reviewed.status, 200);
        if (deferred) {
          assert.equal(reviewed.data.enrichment.state, "skipped");
          assert.equal(
            (await call(path + "/enrichment")).data.state,
            "skipped",
          );
          const approved = await call(path + "/approve", {
            confirmed: true,
            review_token: reviewed.data.review_token,
          });
          assert.equal(approved.status, 200, JSON.stringify(approved.data));
          assert.equal(calls.length, 0);
          const saved = (await db.pool.query("SELECT * FROM zc_orders"))
            .rows[0];
          assert.equal(saved.raw_legacy.sga_deferred, true);
          if (schedule) {
            assert.equal(saved.status, "PENDENTE");
            assert.equal(saved.scheduled_at, "");
            assert.equal(saved.proposed_scheduled_at, "2026-11-14");
            assert.equal(reviewed.data.rows[0].data.status, "PENDENTE");
          }
          return;
        }

        assert.ok(
          ["queued", "running"].includes(reviewed.data.enrichment.state),
        );
        const premature = await call(path + "/approve", {
          confirmed: true,
          review_token: reviewed.data.review_token,
        });
        assert.equal(premature.status, 409);
        assert.match(premature.data.error, /Aguarde/);
        if (cancel) {
          for (
            let i = 0;
            i < 100 && !calls.some((c) => c.path.endsWith("/ABC1D23/placa"));
            i++
          )
            await new Promise((r) => setTimeout(r, 10));
          assert.ok(calls.some((c) => c.path.endsWith("/ABC1D23/placa")));
          assert.equal(
            (await call(path + "/enrichment/stop", { review_token: "invalid" }))
              .status,
            409,
          );
          const stopped = await call(path + "/enrichment/stop", {
            review_token: reviewed.data.review_token,
          });
          assert.equal(stopped.status, 200, JSON.stringify(stopped.data));
          assert.equal(stopped.data.enrichment.state, "cancelled");
          assert.equal(stopped.data.counts.ready, 1);
          const imported = await call(path + "/approve", {
            confirmed: true,
            review_token: stopped.data.review_token,
          });
          assert.equal(imported.status, 200, JSON.stringify(imported.data));
          assert.equal(imported.data.imported, 1);
          release();
          await new Promise((r) => setTimeout(r, 100));
          const saved = (await db.pool.query("SELECT * FROM zc_orders"))
            .rows[0];
          assert.equal(saved.customer_name, "Associado da planilha");
          assert.equal(saved.sga_id, "");
          assert.equal(
            (await call(path + "/enrichment")).data.state,
            "cancelled",
          );
          assert.ok(!calls.some((c) => c.path.endsWith("/42/id")));
          assert.equal(
            (
              await db.pool.query(
                "SELECT count(*)::int n FROM zc_audit WHERE action='sga_enrichment_cancelled'",
              )
            ).rows[0].n,
            1,
          );
          return;
        }
        release();
        let progress;
        for (let n = 0; n < 150; n++) {
          progress = (await call(path + "/enrichment")).data;
          if (["completed", "failed"].includes(progress.state)) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        assert.equal(progress.state, "completed", JSON.stringify(progress));
        assert.equal(progress.filled, 1);
        const preview = (await call(path)).data,
          row = preview.rows[0];
        assert.equal(preview.counts.ready, 1);
        assert.equal(row.data.customer_name, "Associado de teste");
        assert.equal(row.data.document_data.brand, "Marca atual");
        assert.equal(row.data.document_data.color, "Cor atual");
        assert.equal(row.data.sga_classification, "Nome atual vindo da API");
        assert.equal(row.data.sga_status, "Situação atual");
        assert.equal(row.data.imei, "000007260510340");
        assert.equal(row.data.status, "CONCLUÍDO");
        assert.equal(row.data.archive, "COLD");
        const completedStop = await call(path + "/enrichment/stop", {
          review_token: reviewed.data.review_token,
        });
        assert.equal(completedStop.status, 200);
        assert.equal(completedStop.data.enrichment.state, "completed");
        assert.equal(completedStop.data.review_token, preview.review_token);
        assert.ok(!JSON.stringify(preview).includes("DO-NOT-COPY"));
        assert.equal(
          (
            await call(path + "/approve", {
              confirmed: true,
              review_token: preview.review_token,
            })
          ).data.imported,
          1,
        );
        const saved = (await db.pool.query("SELECT * FROM zc_orders")).rows[0];
        assert.equal(saved.raw_legacy.values[2], "");
        assert.equal(saved.sga_id, "42");
        assert.ok(saved.raw_legacy.sga.filled.includes("customer_name"));
        assert.equal(
          calls.filter((c) => c.path === "/usuario/autenticar").length,
          1,
        );
        assert.ok(
          calls
            .filter((c) => c.method === "POST")
            .every((c) => c.path === "/usuario/autenticar"),
        );
      } finally {
        release?.();
        appServer?.closeAllConnections();
        sgaServer?.closeAllConnections();
        if (appServer) await new Promise((r) => appServer.close(r));
        if (sgaServer) await new Promise((r) => sgaServer.close(r));
        await db.close();
      }
    },
  );
test("nome divergente não recebe CPF de outro cadastro; modo explícito SGA permite atualizar e preservar origem", () => {
  const original = {
    state: "ready",
    reason: "",
    validation_issues: [],
    data: {
      customer_name: "Nome da planilha",
      vehicle: "ABC1D23",
      imei: "00001",
      status: "PENDENTE",
      document_data: {},
    },
  };
  const result = {
    status: "found",
    data: {
      customer_name: "Nome atual",
      vehicle: "ABC1D23",
      sga_id: "42",
      contact: "21999990000",
      document_data: { cpf_cnpj: "00000000000" },
    },
  };
  const guarded = completeRow(original, result);
  assert.equal(guarded.sga.status, "conflict");
  assert.equal(guarded.data.document_data.cpf_cnpj, undefined);
  const preferred = completeRow(original, result, "prefer_sga");
  assert.equal(preferred.data.customer_name, "Nome atual");
  assert.equal(preferred.sga.original.customer_name, "Nome da planilha");
  assert.equal(preferred.data.imei, "00001");
  assert.equal(preferred.data.status, "PENDENTE");
  const restored = completeRow(preferred, result, "fill_missing");
  assert.equal(restored.data.customer_name, "Nome da planilha");
  assert.equal(restored.data.document_data.cpf_cnpj, "");
  assert.equal(restored.sga.status, "conflict");
});
