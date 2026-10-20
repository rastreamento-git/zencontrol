const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const { createApp } = require("../src/app");
const { runOne } = require("../src/jobs");
const { IntegrationError } = require("../src/integrations");
const { configuration } = require("../src/config");
const { transaction, databaseConfig } = require("../src/database");
const o = require("../src/orders"),
  d = require("../src/domain");
let db, pool, server, base, adminToken, operatorToken, tech, folder, cfg, jpg;
const password = "Senha-ficticia-para-testes-2026";
async function request(
  route,
  method = "GET",
  body,
  token = adminToken,
  headers = {},
) {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  let data;
  try {
    data = JSON.parse(bytes.toString());
  } catch {
    data = bytes;
  }
  return { status: response.status, data, bytes, headers: response.headers };
}
async function create(extra = {}) {
  const r = await request("/api/orders", "POST", {
    vehicle: "TES1A23",
    service: "Instalação",
    customer_name: "Associado de exemplo",
    technician_id: tech.id,
    scheduled_at: d.today() + "T10:30",
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  // Regression fixtures explicitly exercise the migrated WhatsApp workflow.
  await pool.query("UPDATE zc_orders SET workflow_mode='legacy' WHERE id=$1", [
    r.data.id,
  ]);
  return r.data;
}
async function fresh(id) {
  return (await request("/api/orders/" + id)).data;
}
async function hook(body, extra = {}) {
  return request(
    "/webhook",
    "POST",
    {
      event: "onmessage",
      data: {
        from: "5511999999999@c.us",
        id: randomUUID(),
        type: "chat",
        body,
        ...extra,
      },
    },
    null,
    { "X-Webhook-Token": cfg.ZEN_WEBHOOK_SECRET },
  );
}
async function receive(order, terminator = ".", caption = "") {
  await hook("OS: " + order.id + "\nPlaca ou Chassi: " + order.vehicle);
  await hook(caption, { type: "image" });
  const r = await hook(terminator);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.batch_id;
}
async function drain(adapters = {}, config = cfg) {
  let n = 0;
  while (
    await runOne(pool, config, {
      wpp: {
        media: async () => jpg,
        document: async () => ({ status: "success" }),
      },
      sga: { classification: async () => ({}), upload: async () => ({}) },
      ...adapters,
    })
  ) {
    if (++n > 50) throw Error("Fila não finalizou.");
  }
}
before(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "zencontrol-test-"));
  cfg = configuration({
    APP_PASSWORD: password,
    APP_ADMIN_USER: "admin",
    SESSION_SECRET: "session-secret-ficticio-para-testes-123456",
    ZEN_WEBHOOK_SECRET: "webhook-secret-ficticio-para-testes-123456",
    ZEN_DATA_DIR: folder,
    INTEGRATIONS_ENABLED: "true",
    SGA_SYNC_ENABLED: "false",
    AUTO_CLOSE_ENABLED: "false",
    NODE_ENV: "test",
    CORS_ORIGINS: "http://localhost:5173",
  });
  db = await testDatabase();
  pool = db.pool;
  await migrate(pool);
  const app = createApp(pool, cfg);
  await app.locals.ready();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
  const login = await request(
    "/api/auth/login",
    "POST",
    { login: "admin", password },
    null,
  );
  assert.equal(login.status, 200);
  adminToken = login.data.token;
  const user = await request("/api/users", "POST", {
    login: "operador",
    nome: "Operador de teste",
    papel: "operador",
    password,
  });
  assert.equal(user.status, 200, JSON.stringify(user.data));
  operatorToken = (
    await request(
      "/api/auth/login",
      "POST",
      { login: "operador", password },
      null,
    )
  ).data.token;
  const t = await request("/api/technicians", "POST", {
    name: "Técnico de exemplo",
    phone: "5511999999999",
    price_install: "80,20",
    price_maintenance: "60.10",
    price_removal: "50",
    price_visit: "35",
  });
  assert.equal(t.status, 200);
  tech = (await request("/api/technicians")).data.items.find(
    (x) => x.id === t.data.id,
  );
  jpg = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "#2563eb" },
  })
    .jpeg()
    .toBuffer();
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (db) await db.close();
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});
test("exige segredos e parâmetros de conexão explícitos", () => {
  assert.throws(() => configuration({}), /APP_PASSWORD/);
  assert.throws(
    () => configuration({ APP_PASSWORD: password }),
    /SESSION_SECRET/,
  );
  assert.throws(() => databaseConfig({}), /DATABASE_URL/);
  assert.equal(
    databaseConfig({
      DATABASE_URL: "postgres://x:x@localhost/test?sslmode=disable",
    }).ssl.rejectUnauthorized,
    true,
  );
  assert.equal(
    databaseConfig({
      DATABASE_URL: "postgres://x:x@localhost/test",
      DATABASE_SSL: "disable",
    }).ssl,
    false,
  );
});
test("datas impossíveis e valores monetários inválidos são rejeitados", () => {
  assert.equal(d.date("31/02/2026"), "");
  assert.equal(d.date("15/10/2026 09:30", true), "2026-10-15T09:30");
  assert.equal(d.money("R$ 1.234,56"), 123456);
  assert.equal(d.money("0.10") + d.money("0.20"), 30);
  for (const value of ["-1", "1.234", "NaN", "1e6"])
    assert.throws(() => d.money(value));
});
test("a origem pública da própria aplicação pode carregar os módulos do frontend", async () => {
  const r = await request("/api/meta", "GET", undefined, adminToken, {
    Origin: cfg.PUBLIC_URL,
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), cfg.PUBLIC_URL);
});
test("trocar o técnico ou o veículo após o recebimento impede baixa automática", async () => {
  for (const change of [
    { vehicle: "TROC456" },
    { technician_id: null, status: "PENDENTE" },
  ]) {
    const row = await create({ vehicle: "TROC123" });
    const bid = await receive(row);
    assert.equal(
      (
        await request("/api/orders/" + row.id, "PATCH", {
          ...change,
          version: row.version,
        })
      ).status,
      200,
    );
    await drain({}, { ...cfg, AUTO_CLOSE_ENABLED: true });
    const b = await d.one(pool, "SELECT * FROM zc_batches WHERE id=$1", [bid]);
    assert.equal(b.state, "needs_review");
    assert.notEqual((await fresh(row.id)).status, "CONCLUÍDO");
    await request("/api/orders/" + row.id, "DELETE", {
      version: (await fresh(row.id)).version,
      reason: "Encerramento do caso de teste.",
    });
  }
});
test("migrações são idempotentes e rollback não deixa gravações parciais", async () => {
  await migrate(pool);
  assert.equal(
    Number((await d.one(pool, "SELECT count(*) n FROM schema_migrations")).n),
    8,
  );
  await assert.rejects(
    transaction(pool, async (tx) => {
      await o.insert(tx, "zc_volunteers", { name: "Deve desaparecer" });
      throw Error("rollback");
    }),
  );
  assert.equal(
    await d.one(pool, "SELECT id FROM zc_volunteers WHERE name=$1", [
      "Deve desaparecer",
    ]),
    null,
  );
});
test("APIs exigem sessão e respostas não expõem hashes", async () => {
  assert.equal(
    (await request("/api/orders", "GET", undefined, null)).status,
    401,
  );
  assert.equal(
    (await request("/api/meta", "GET", undefined, adminToken + "x")).status,
    401,
  );
  const r = await request("/api/users");
  assert.equal(r.status, 200);
  assert.equal(JSON.stringify(r.data).includes("senha_hash"), false);
  assert.equal(r.headers.get("x-powered-by"), null);
  assert.match(
    r.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal((await request("/healthz", "GET", undefined, null)).status, 200);
});
test("origens não autorizadas e corpo JSON em formato indevido são bloqueados", async () => {
  assert.equal(
    (
      await request("/api/meta", "GET", undefined, adminToken, {
        Origin: "https://origem-invalida.example",
      })
    ).status,
    403,
  );
  assert.equal((await request("/api/orders", "POST", [])).status, 400);
  assert.equal(
    (await request("/api/sql", "POST", { sql: "DROP TABLE zc_orders" })).status,
    410,
  );
});
test("administrador e operador têm acesso completo às funções da central", async () => {
  for (const route of [
    "/api/users",
    "/api/finance/settlements",
    "/api/settings",
    "/api/backup",
    "/api/audit",
  ])
    assert.equal(
      (await request(route, "GET", undefined, operatorToken)).status,
      200,
      route,
    );
  assert.equal(
    (
      await request(
        "/api/technicians",
        "POST",
        { name: "Operador autorizado" },
        operatorToken,
      )
    ).status,
    200,
  );
  const techs = (
    await request("/api/technicians", "GET", undefined, operatorToken)
  ).data.items;
  assert.ok(techs.every((t) => Number.isSafeInteger(t.price_install)));
  assert.equal(
    (await request("/api/meta", "GET", undefined, operatorToken)).status,
    200,
  );
});
test("cadastro valida campos e preserva agendamento e adicional separado", async () => {
  assert.equal(
    (await request("/api/orders", "POST", { vehicle: "A" })).status,
    400,
  );
  assert.equal(
    (
      await request("/api/orders", "POST", {
        vehicle: "ABC1234",
        customer_name: "Teste",
        service: "Instalação",
        status: "CONCLUÍDO",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/orders", "POST", {
        vehicle: "ABC1234",
        customer_name: "Teste",
        service: "Instalação",
        scheduled_at: "2026-02-31T10:00",
      })
    ).status,
    400,
  );
  const row = await create({ vehicle: "abc-1a23", additional: "Tag Extra" });
  assert.equal(row.vehicle, "ABC1A23");
  assert.equal(row.status, "AGENDADO");
  assert.equal(
    (await fresh(row.id + "_EXTRA")).service,
    "Instalação (Equipamento adicional)",
  );
  assert.equal(row.raw_legacy, undefined);
  assert.equal(
    (await fresh(row.id)).history.some((x) => x.action === "created"),
    true,
  );
});
test("edições simultâneas têm uma confirmação e um conflito", async () => {
  const row = await create();
  const responses = await Promise.all(
    ["Primeiro", "Segundo"].map((notes) =>
      request("/api/orders/" + row.id, "PATCH", {
        version: row.version,
        notes,
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await fresh(row.id)).version, row.version + 1);
});
test("baixa exige técnico e motivo, e reabertura exige acesso da central", async () => {
  const row = await create();
  assert.equal(
    (
      await request("/api/orders/" + row.id + "/complete", "POST", {
        version: row.version,
        reason: "ok",
      })
    ).status,
    400,
  );
  const done = await request(
    "/api/orders/" + row.id + "/complete",
    "POST",
    { version: row.version, reason: "Serviço conferido e finalizado." },
    operatorToken,
  );
  assert.equal(done.status, 200);
  assert.equal(done.data.status, "CONCLUÍDO");
  assert.equal(done.data.completed_at, d.today());
  assert.equal(
    (
      await request("/api/orders/" + row.id, "PATCH", {
        version: done.data.version,
        status: "PENDENTE",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/api/orders/" + row.id + "/reopen",
        "POST",
        { version: done.data.version, reason: "Correção administrativa." },
        operatorToken,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/orders/" + row.id + "/reopen", "POST", {
        version: done.data.version,
        reason: "Correção administrativa.",
      })
    ).status,
    409,
  );
  assert.equal((await fresh(row.id)).completed_at, "");
  const noTech = await create({ technician_id: null, scheduled_at: "" });
  assert.equal(
    (
      await request("/api/orders/" + noTech.id + "/complete", "POST", {
        version: noTech.version,
        reason: "Motivo informado.",
      })
    ).status,
    400,
  );
});
test("PDF exige autenticação e usa documento PDF válido", async () => {
  const row = await create();
  assert.equal(
    (await request("/api/orders/" + row.id + "/pdf", "GET", undefined, null))
      .status,
    401,
  );
  const r = await request("/api/orders/" + row.id + "/pdf");
  assert.equal(r.status, 200);
  assert.equal(r.bytes.subarray(0, 5).toString(), "%PDF-");
});
test("documento complementar é persistido, mascara dados e restringe a versão integral", async () => {
  const fixture = require("./fixtures/order-document.cjs"),
    { readPdf } = require("./helpers/pdf.cjs");
  const row = await create({
    document_data: fixture.document_data,
    technician_name: "Técnico forjado",
    scheduled_at: "2026-10-20T14:30",
  });
  const saved = await fresh(row.id);
  assert.equal(saved.document_data.cpf_cnpj, fixture.document_data.cpf_cnpj);
  assert.equal(saved.technician_name, tech.name);
  const pdf = await readPdf(
    (
      await request(
        "/api/orders/" +
          row.id +
          "/pdf?technician_name=Forjado&service=Forjado&scheduled_at=1900-01-01",
      )
    ).bytes,
  );
  assert.ok(pdf.text.includes(tech.name));
  assert.ok(pdf.text.includes("20/10/2026 às 14:30"));
  assert.ok(!pdf.text.includes("Forjado"));
  assert.ok(!pdf.text.includes(fixture.document_data.cpf_cnpj));
  const full = await readPdf(
    (await request("/api/orders/" + row.id + "/pdf?integral=1")).bytes,
  );
  assert.ok(full.text.includes(fixture.document_data.cpf_cnpj));
  const limited = await readPdf(
    (
      await request(
        "/api/orders/" + row.id + "/pdf?integral=1",
        "GET",
        undefined,
        operatorToken,
      )
    ).bytes,
  );
  assert.ok(limited.text.includes(fixture.document_data.cpf_cnpj));
  assert.equal(
    (
      await request(
        "/api/orders/" + row.id + "/dispatch",
        "POST",
        { version: saved.version - 1, masked: false },
        operatorToken,
      )
    ).status,
    409,
  );
  const bad = await request("/api/orders/" + row.id, "PATCH", {
    version: saved.version,
    document_data: { service: "Retirada" },
  });
  assert.equal(bad.status, 400);
  assert.equal((await fresh(row.id)).version, saved.version);
  const same = await request("/api/orders/" + row.id, "PATCH", {
    version: saved.version,
    document_data: saved.document_data,
  });
  assert.equal(same.status, 200);
  assert.equal(same.data.version, saved.version);
});
test("envios entram em fila e somente a confirmação marca a OS", async () => {
  const row = await create();
  const first = await request("/api/orders/" + row.id + "/dispatch", "POST", {
    version: row.version,
  });
  assert.equal(first.status, 202);
  assert.equal((await fresh(row.id)).dispatched_at, "");
  assert.equal(
    (
      await request("/api/orders/" + row.id + "/dispatch", "POST", {
        version: row.version,
      })
    ).status,
    409,
  );
  let calls = 0;
  await drain({
    wpp: {
      document: async (destination, bytes) => {
        calls++;
        assert.equal(destination, tech.phone);
        assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      },
    },
  });
  assert.equal(calls, 1);
  assert.ok((await fresh(row.id)).dispatched_at);
  assert.equal(
    (
      await d.one(pool, "SELECT state FROM zc_jobs WHERE id=$1", [
        first.data.job_id,
      ])
    ).state,
    "succeeded",
  );
});
test("envio antigo é interrompido se a OS foi editada antes do worker", async () => {
  const row = await create();
  const queued = await request("/api/orders/" + row.id + "/dispatch", "POST", {
    version: row.version,
  });
  assert.equal(
    (
      await request("/api/orders/" + row.id, "PATCH", {
        version: row.version,
        notes: "Local corrigido",
      })
    ).status,
    200,
  );
  let calls = 0;
  await drain({ wpp: { document: async () => calls++ } });
  assert.equal(calls, 0);
  assert.equal(
    (
      await d.one(pool, "SELECT state FROM zc_jobs WHERE id=$1", [
        queued.data.job_id,
      ])
    ).state,
    "failed",
  );
});
test("envio sem resposta confirmada não é repetido automaticamente", async () => {
  const row = await create();
  const queued = await request("/api/orders/" + row.id + "/dispatch", "POST", {
    version: row.version,
  });
  let calls = 0;
  await drain({
    wpp: {
      document: async () => {
        calls++;
        throw new IntegrationError("Resposta não confirmada.", true);
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal((await fresh(row.id)).dispatched_at, "");
  assert.equal(
    (
      await d.one(pool, "SELECT state FROM zc_jobs WHERE id=$1", [
        queued.data.job_id,
      ])
    ).state,
    "uncertain",
  );
  assert.equal(
    (await request("/api/jobs/" + queued.data.job_id + "/retry", "POST", {}))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        "/api/jobs/" + queued.data.job_id + "/retry",
        "POST",
        { confirmed_no_effect: false },
        operatorToken,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/jobs/" + queued.data.job_id + "/retry", "POST", {
        confirmed_no_effect: true,
      })
    ).status,
    200,
  );
  await drain();
});
test("webhook rejeita segredo incorreto, mensagens próprias e duplicatas", async () => {
  assert.equal(
    (await request("/webhook", "POST", { event: "onmessage" }, null)).status,
    401,
  );
  const id = randomUUID();
  assert.equal((await hook("Teste", { id, fromMe: true })).data.ignored, true);
  assert.equal((await hook("Teste", { id })).data.buffered, true);
  assert.equal((await hook("Teste", { id })).data.duplicate, true);
  await hook(".");
});
test("grupo compartilhado sem identificação inequívoca não recebe atribuição", async () => {
  await pool.query("UPDATE zc_technicians SET receive_group=$1 WHERE id=$2", [
    "123-456@g.us",
    tech.id,
  ]);
  await o.insert(pool, "zc_technicians", {
    name: "Segundo técnico no grupo",
    phone: "5511888888888",
    receive_group: "123-456@g.us",
  });
  const r = await hook("Placa: TES1A23", { from: "123-456@g.us", author: "" });
  assert.equal(r.data.reason, "unknown_technician");
});
test("novo veículo não acrescenta sua foto ao lote do veículo anterior", async () => {
  const first = await create({ vehicle: "SEPA123" }),
    second = await create({ vehicle: "SEPB456" });
  await hook("Placa: " + first.vehicle);
  await hook("", { id: "foto-anterior-" + randomUUID(), type: "image" });
  const newId = "foto-nova-" + randomUUID();
  await hook("Placa: " + second.vehicle, { id: newId, type: "image" });
  const oldBatch = await d.one(
    pool,
    "SELECT * FROM zc_batches WHERE vehicle=$1",
    [first.vehicle],
  );
  assert.equal(oldBatch.expected_count, 1);
  assert.equal(oldBatch.hub, true);
  assert.equal(
    await d.one(
      pool,
      "SELECT id FROM zc_evidence WHERE batch_id=$1 AND message_id=$2",
      [oldBatch.id, newId],
    ),
    null,
  );
  const end = await hook(".");
  assert.equal(
    (
      await d.one(pool, "SELECT expected_count FROM zc_batches WHERE id=$1", [
        end.data.batch_id,
      ])
    ).expected_count,
    1,
  );
  await drain();
});
test("OS explícita com veículo divergente fica para conferência", async () => {
  const row = await create({ vehicle: "VALA123" });
  await hook("OS: " + row.id + "\nPlaca: OUTR456");
  await hook("", { type: "image" });
  const end = await hook(".");
  await drain({}, { ...cfg, AUTO_CLOSE_ENABLED: true });
  const b = await d.one(pool, "SELECT * FROM zc_batches WHERE id=$1", [
    end.data.batch_id,
  ]);
  assert.equal(b.order_id, null);
  assert.equal(b.state, "needs_review");
  assert.equal((await fresh(row.id)).status, "AGENDADO");
});
test("download completo aguarda validação quando baixa automática está desabilitada", async () => {
  const row = await create({ vehicle: "FOTO123" });
  const id = await receive(row);
  await drain();
  assert.equal((await fresh(row.id)).status, "AGUARDANDO VALIDAÇÃO");
  const batch = (await request("/api/batches/" + id)).data;
  assert.equal(batch.files.length, 1);
  assert.equal(batch.files[0].state, "ready");
  const photo = await request("/api/evidence/" + batch.files[0].id);
  assert.equal(photo.status, 200);
  assert.match(photo.headers.get("content-type"), /image\/jpeg/);
  assert.equal(
    (
      await request(
        "/api/evidence/" + batch.files[0].id,
        "GET",
        undefined,
        null,
      )
    ).status,
    401,
  );
});
test("edição de foto preserva original e bloqueia gravação sobre versão antiga", async () => {
  const row = await create({ vehicle: "EDIT123" });
  const id = await receive(row);
  await drain();
  const item = await d.one(
    pool,
    "SELECT * FROM zc_evidence WHERE batch_id=$1",
    [id],
  );
  const original = await fs.readFile(path.join(folder, "media", item.path));
  const edited = await sharp({
    create: { width: 80, height: 60, channels: 3, background: "#d53a4b" },
  })
    .jpeg()
    .toBuffer();
  const body = {
    image: "data:image/jpeg;base64," + edited.toString("base64"),
    sha256: item.sha256,
  };
  assert.equal(
    (await request("/api/evidence/" + item.id + "/edit", "POST", body)).status,
    200,
  );
  const current = await d.one(pool, "SELECT * FROM zc_evidence WHERE id=$1", [
    item.id,
  ]);
  assert.equal(current.original_path, item.path);
  assert.notEqual(current.path, item.path);
  assert.equal(
    (await request("/api/evidence/" + item.id + "/edit", "POST", body)).status,
    409,
  );
  assert.ok(
    (await fs.readFile(path.join(folder, "media", item.path))).equals(original),
  );
  const review = await request("/api/batches/" + id + "/review", "POST", {
    order_id: row.id,
    reason: "Fotos e número de série conferidos.",
    imeis: "123456789012345",
    complete: true,
  });
  assert.equal(review.status, 200, JSON.stringify(review.data));
  assert.equal((await fresh(row.id)).imei, "123456789012345");
  assert.equal((await fresh(row.id)).status, "CONCLUÍDO");
  assert.equal(
    (
      await request("/api/evidence/" + item.id + "/edit", "POST", {
        ...body,
        sha256: current.sha256,
      })
    ).status,
    409,
  );
});
test("baixa automática só conclui bloco completo, correspondente e fora do hub", async () => {
  const row = await create({ vehicle: "AUTO123" });
  const bid = await receive(row);
  await drain({}, { ...cfg, AUTO_CLOSE_ENABLED: true });
  assert.equal((await fresh(row.id)).status, "CONCLUÍDO");
  assert.equal(
    (await d.one(pool, "SELECT state FROM zc_batches WHERE id=$1", [bid]))
      .state,
    "completed",
  );
  const hub = await create({ vehicle: "HUBA123" });
  const hubId = await receive(hub, "#.#");
  await drain({}, { ...cfg, AUTO_CLOSE_ENABLED: true });
  assert.equal((await fresh(hub.id)).status, "AGUARDANDO VALIDAÇÃO");
  assert.equal(
    (await d.one(pool, "SELECT state FROM zc_batches WHERE id=$1", [hubId]))
      .state,
    "ready",
  );
});
test("falha de foto impede baixa e mantém lote para conferência", async () => {
  const row = await create({ vehicle: "FALH123" });
  const bid = await receive(row);
  await drain(
    { wpp: { media: async () => Buffer.from("arquivo inválido") } },
    { ...cfg, AUTO_CLOSE_ENABLED: true },
  );
  const b = await d.one(pool, "SELECT * FROM zc_batches WHERE id=$1", [bid]);
  assert.equal(b.state, "needs_review");
  assert.equal((await fresh(row.id)).status, "AGENDADO");
  assert.equal(
    (
      await request("/api/batches/" + bid + "/review", "POST", {
        reason: "Aprovação indevida.",
        complete: true,
      })
    ).status,
    400,
  );
  await pool.query(
    "UPDATE zc_jobs SET state='failed' WHERE idempotency_key=$1",
    ["batch:" + bid],
  );
});
test("SGA só recebe fotos aprovadas e mantém confirmação de envio", async () => {
  const row = await create({ vehicle: "SGAF123", sga_id: "1234" });
  const bid = await receive(row);
  await drain();
  assert.equal(
    (await request("/api/batches/" + bid + "/upload", "POST", {})).status,
    400,
  );
  assert.equal(
    (
      await request("/api/batches/" + bid + "/review", "POST", {
        reason: "Fotos conferidas e aprovadas.",
        complete: false,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/batches/" + bid + "/upload", "POST", {})).status,
    202,
  );
  let calls = 0;
  await drain({
    sga: {
      upload: async (id, photos) => {
        calls++;
        assert.equal(id, "1234");
        assert.equal(photos.length, 1);
      },
    },
  });
  assert.equal(calls, 1);
  assert.ok(
    (
      await d.one(pool, "SELECT sga_uploaded_at FROM zc_batches WHERE id=$1", [
        bid,
      ])
    ).sga_uploaded_at,
  );
  assert.equal(
    (await request("/api/batches/" + bid + "/upload", "POST", {})).status,
    409,
  );
});
test("classificação SGA só é gravada depois da resposta confirmada", async () => {
  const row = await create({ vehicle: "CLAS123", sga_id: "9876" });
  await transaction(pool, (tx) =>
    o.complete(tx, row.id, "Teste", "Baixa conferida para SGA.", {
      ...cfg,
      SGA_SYNC_ENABLED: true,
    }),
  );
  assert.equal((await fresh(row.id)).sga_classification, "");
  let calls = 0;
  await drain(
    {
      sga: {
        classification: async (id, code) => {
          calls++;
          assert.equal(id, "9876");
          assert.equal(code, "1");
        },
      },
    },
    { ...cfg, SGA_SYNC_ENABLED: true },
  );
  assert.equal(calls, 1);
  assert.equal((await fresh(row.id)).sga_classification, "Concluído");
});
test("fechamento usa centavos, prévia consistente e impede pagamento duplicado", async () => {
  const t = await o.insert(pool, "zc_technicians", {
    name: "Financeiro exemplo",
    price_install: 8020,
  });
  const row = await create({ technician_id: t.id, vehicle: "FINA123" });
  assert.equal(
    (
      await request("/api/orders/" + row.id + "/extras", "POST", {
        type: "Pedágio",
        amount: "1,30",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await request("/api/orders/" + row.id + "/complete", "POST", {
        version: row.version,
        reason: "Serviço finalizado para cálculo.",
      })
    ).status,
    200,
  );
  const endpoint =
    "/api/finance/preview?technician_id=" +
    t.id +
    "&start=" +
    d.today() +
    "&end=" +
    d.today();
  const p = (await request(endpoint)).data;
  assert.equal(p.total_cents, 8150);
  const body = {
    technician_id: t.id,
    start: p.start,
    end: p.end,
    expected_total: p.total_cents,
    order_ids: p.orders.map((x) => x.id),
  };
  assert.equal(
    (
      await request("/api/finance/settlements", "POST", {
        ...body,
        expected_total: 1,
      })
    ).status,
    409,
  );
  const settlement = await request("/api/finance/settlements", "POST", body);
  assert.equal(settlement.status, 201);
  assert.equal((await request(endpoint)).data.total_cents, 0);
  assert.equal(
    (await request("/api/finance/settlements", "POST", body)).status,
    400,
  );
  const current = await fresh(row.id);
  assert.equal(
    (
      await request("/api/orders/" + row.id, "PATCH", {
        version: current.version,
        service: "Manutenção",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/api/orders/" + row.id + "/reopen", "POST", {
        version: current.version,
        reason: "Não deve reabrir.",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/api/orders/" + row.id + "/extras", "POST", {
        amount: "10",
      })
    ).status,
    409,
  );
  const pdf = await request(
    "/api/finance/settlements/" + settlement.data.id + "/pdf",
  );
  assert.equal(pdf.status, 200);
  assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
  await pool.query(
    "UPDATE zc_technicians SET price_install=99999 WHERE id=$1",
    [t.id],
  );
  assert.equal(
    (
      await d.one(pool, "SELECT snapshot FROM zc_settlements WHERE id=$1", [
        settlement.data.id,
      ])
    ).snapshot.total_cents,
    8150,
  );
});
test("arquivamento mensal simula antes de aplicar e mantém ordens abertas no HOT", async () => {
  const row = await create({ vehicle: "ARQA123" });
  await pool.query(
    "UPDATE zc_orders SET created_date='2020-01-01',archive='COLD' WHERE id=$1",
    [row.id],
  );
  const simulated = await request("/api/archive-month", "POST", {
    month: d.today().slice(0, 7),
  });
  assert.equal(simulated.data.dry_run, true);
  assert.equal((await fresh(row.id)).archive, "COLD");
  assert.equal(
    (
      await request("/api/archive-month", "POST", {
        month: d.today().slice(0, 7),
        dry_run: false,
      })
    ).status,
    200,
  );
  assert.equal((await fresh(row.id)).archive, "HOT");
});
test("exportação CSV neutraliza fórmulas e backup não contém contas ou segredos", async () => {
  await create({
    customer_name: '=HYPERLINK("https://example.invalid")',
    vehicle: "CSVA123",
  });
  const csv = await request("/api/export/orders.csv");
  assert.equal(csv.status, 200);
  assert.ok(csv.bytes.toString().includes("'=HYPERLINK"));
  const backup = await request("/api/backup");
  assert.equal(backup.status, 200);
  assert.equal(backup.bytes.subarray(0, 2).toString(), "PK");
});
test("cadastro e troca aceitam oito caracteres completos e recusam cada categoria ausente", async () => {
  const payload = {
    login: "senha.oito",
    nome: "Teste de política de senha",
    papel: "operador",
  };
  for (const value of [
    "Aa1!aaa",
    "abcdef1!",
    "ABCDEF1!",
    "Abcdefg!",
    "Abcdefg1",
    "Abcdef1 ",
  ]) {
    const rejected = await request("/api/users", "POST", {
      ...payload,
      password: value,
    });
    assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
  }
  const created = await request("/api/users", "POST", {
    ...payload,
    password: "Ab1!cdef",
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const signed = await request(
    "/api/auth/login",
    "POST",
    { login: payload.login, password: "Ab1!cdef" },
    null,
  );
  assert.equal(signed.status, 200);
  const token = signed.data.token;
  const rejected = await request(
    "/api/auth/password",
    "POST",
    { current_password: "Ab1!cdef", new_password: "Abcdefg1" },
    token,
  );
  assert.equal(rejected.status, 400);
  assert.equal(
    (await request("/api/meta", "GET", undefined, token)).status,
    200,
  );
  const changed = await request(
    "/api/auth/password",
    "POST",
    { current_password: "Ab1!cdef", new_password: "Xy2@mnop" },
    token,
  );
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(
    (await request("/api/meta", "GET", undefined, token)).status,
    401,
  );
  const again = await request(
    "/api/auth/login",
    "POST",
    { login: payload.login, password: "Xy2@mnop" },
    null,
  );
  assert.equal(again.status, 200);
});
test("alteração de senha revoga a sessão anterior e não afeta outras contas", async () => {
  assert.equal(
    (
      await request(
        "/api/auth/password",
        "POST",
        { current_password: "incorreta", new_password: password + "-nova" },
        operatorToken,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/auth/password",
        "POST",
        { current_password: password, new_password: password + "-nova" },
        operatorToken,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/meta", "GET", undefined, operatorToken)).status,
    401,
  );
  assert.equal((await request("/api/meta")).status, 200);
});
