const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const intake = require("../src/sga-intake");
const o = require("../src/orders");
const d = require("../src/domain");
const { productsSnapshot } = require("../src/sga-products");
const { SGAClient } = require("../src/integrations");
const { createApp } = require("../src/app");
const { hashPassword } = require("../src/auth");
let db,
  tech,
  config,
  movements = [],
  overrides = {},
  lookupCalls = 0;
const day = d.today();
const cfg = {
  SGA_READ_ENABLED: true,
  SGA_SCHEDULING_GUARD: true,
  SESSION_SECRET: "test-only-intake-session-secret-1234567890",
};
const client = {
  ready: () => true,
  catalogs: async () => ({
    items: {
      classifications: [
        { code: "42", label: "INSTALAÇÃO PENDENTE", active: true },
      ],
      statuses: [],
    },
  }),
  pendingMovements: async () => structuredClone(movements),
  lookup: async ({ sga_id }) => {
    lookupCalls++;
    return data(sga_id);
  },
};
function movement(id, changes = {}) {
  return {
    codigo_alteracao: "evt-" + id,
    codigo_veiculo: id,
    nome_campo_tabela: "codigo_classificacao",
    valor_anterior: "41",
    valor_posterior: "42",
    data_alteracao: day + "T10:00:00-0300",
    ...changes,
  };
}
function data(id) {
  return {
    sga_id: id,
    vehicle: "SGA" + String(id).padStart(4, "0"),
    chassis: "",
    customer_name: "Associado fictício " + id,
    sga_source: { classification_code: "42", status_code: "1" },
    sga_assessment: {
      vehicle_status: "ATIVO",
      vehicle_classification: "INSTALAÇÃO PENDENTE",
      customer_status: "ATIVO",
      customer_classification: "ASSOCIADO",
      financial_status: "ADIMPLENTE",
    },
    sga_products: productsSnapshot(
      {
        codigo_veiculo: id,
        produtos: [
          { codigo_produto: "2371", descricao: "Perfurado", situacao: "ATIVO" },
        ],
      },
      id,
    ),
    fipe_value: "R$ 35.000,00",
    document_data: { model: "Fiat Uno", scheduled_service: "Instalação", vehicle_type: "Automóvel", customer_state: "RJ" },
    raw_vehicle: {
      codigo_veiculo: id,
      campo_futuro: { integral: ["não descartar", 42] },
    },
    raw_products: {
      codigo_veiculo: id,
      produtos: [
        {
          codigo_produto: "2371",
          descricao: "Perfurado",
          situacao: "ATIVO",
          valor: "-10.00",
        },
      ],
    },
    ...structuredClone(overrides[id] || {}),
  };
}
before(async () => {
  db = await testDatabase();
  await migrate(db.pool);
  tech = (
    await db.pool.query(
      "INSERT INTO zc_technicians(name) VALUES('Técnico fictício') RETURNING id",
    )
  ).rows[0].id;
  config = await intake.configuration(db.pool);
  config = await intake.saveConfiguration(
    db.pool,
    client,
    { ...config, pending_code: "42", enabled: false },
    "Administrador",
  );
});
after(async () => db.close());
async function run() {
  const task = await intake.enqueue(db.pool, client, "Administrador");
  assert.equal(await intake.runCycle(db.pool, cfg, { client }), true);
  return (
    await db.pool.query("SELECT * FROM zc_sga_intake_runs WHERE id=$1", [
      task.id,
    ])
  ).rows[0];
}
test("recebe somente a transição de hoje, preserva o conteúdo bruto e não reserva número de OS", async () => {
  const oldDay = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  movements = [
    movement("901"),
    movement("902", { data_alteracao: oldDay + "T10:00:00-0300" }),
    movement("903", { valor_posterior: "99" }),
    movement("904", { nome_campo_tabela: "placa" }),
    movement("907", { valor_anterior: "42" }),
    movement("908"),
  ];
  overrides["908"] = {
    sga_source: { classification_code: "99", status_code: "1" },
  };
  const runResult = await run();
  assert.equal(runResult.state, "completed");
  assert.equal(runResult.summary.imported, 1);
  assert.equal(runResult.summary.no_longer_pending, 1);
  const entry = (
    await db.pool.query("SELECT * FROM zc_sga_intake WHERE sga_vehicle_id=$1", [
      "901",
    ])
  ).rows[0];
  assert.equal(entry.order_id, null);
  assert.deepEqual(entry.raw_source.vehicle.campo_futuro, {
    integral: ["não descartar", 42],
  });
  assert.equal(entry.raw_source.products.produtos[0].valor, "-10.00");
  assert.equal(entry.data.sga_products.perfurado, true);
  assert.equal((await db.pool.query("SELECT * FROM zc_orders")).rows.length, 0);
  assert.equal(
    (await db.pool.query("SELECT * FROM zc_order_counters")).rows.length,
    0,
  );
});
test("repetição e execução concorrente não duplicam ou sobrescrevem a entrada original", async () => {
  const before = (
    await db.pool.query("SELECT * FROM zc_sga_intake WHERE sga_vehicle_id=$1", [
      "901",
    ])
  ).rows[0];
  movements = [movement("901"), movement("901")];
  overrides["901"] = {
    customer_name: "Nome alterado no SGA",
    raw_vehicle: { campo_futuro: "outro conteúdo" },
  };
  await intake.enqueue(db.pool, client, "Administrador");
  await Promise.all([
    intake.runCycle(db.pool, cfg, { client }),
    intake.runCycle(db.pool, cfg, { client }),
  ]);
  const after = (
    await db.pool.query("SELECT * FROM zc_sga_intake WHERE sga_vehicle_id=$1", [
      "901",
    ])
  ).rows[0];
  assert.deepEqual(after, before);
  delete overrides["901"];
});
test("cadastro já existente na operação é ignorado integralmente", async () => {
  const original = await o.create(
    db.pool,
    {
      vehicle: data("905").vehicle,
      customer_name: data("905").customer_name,
      service: "Instalação",
      sga_id: "905",
      notes: "Não sobrescrever",
    },
    "Teste",
  );
  movements = [movement("905")];
  const result = await run();
  assert.equal(result.summary.imported, 0);
  assert.equal(result.summary.duplicates, 1);
  assert.equal((await o.get(db.pool, original.id)).notes, "Não sobrescrever");
  assert.equal((await o.get(db.pool, original.id)).version, original.version);
});
test("atribuição exige técnico, base, agendamento e consulta regular; número só nasce uma vez", async () => {
  const entry = (
    await db.pool.query("SELECT * FROM zc_sga_intake WHERE sga_vehicle_id=$1", [
      "901",
    ])
  ).rows[0];
  const input = {
    technician_id: tech,
    scheduled_at: day + "T15:00",
    archive: "WARM",
    electric: "no",
    sticker_discount_opt_in: true,
  };
  const before = (await db.pool.query("SELECT count(*)::int n FROM zc_orders"))
    .rows[0].n;
  await assert.rejects(
    intake.assign(db.pool, cfg, client, entry.id, {}, "Operação"),
    /Selecione o técnico/,
  );
  await assert.rejects(
    intake.assign(
      db.pool,
      cfg,
      client,
      entry.id,
      { ...input, archive: "" },
      "Operação",
    ),
    /base/,
  );
  overrides["901"] = {
    sga_assessment: {
      ...data("901").sga_assessment,
      financial_status: "INADIMPLENTE",
    },
  };
  await assert.rejects(
    intake.assign(db.pool, cfg, client, entry.id, input, "Operação"),
    /Agendamento bloqueado/,
  );
  assert.equal(
    (await db.pool.query("SELECT count(*)::int n FROM zc_orders")).rows[0].n,
    before,
  );
  delete overrides["901"];
  const [first, again] = await Promise.all([
    intake.assign(db.pool, cfg, client, entry.id, input, "Operação"),
    intake.assign(db.pool, cfg, client, entry.id, input, "Operação"),
  ]);
  assert.equal(first.id, again.id);
  assert.match(
    first.id,
    new RegExp("^" + day.replaceAll("-", "") + "[0-9A-F]{3}$"),
  );
  assert.equal(first.technician_id, tech);
  assert.equal(first.archive, "WARM");
  assert.equal(first.sticker_discount_opt_in, true);
  assert.equal(first.sga_check.products.perfurado, true);
  assert.equal(
    first.raw_legacy[0].original.vehicle.campo_futuro.integral[0],
    "não descartar",
  );
  assert.equal(
    (await db.pool.query("SELECT count(*)::int n FROM zc_orders")).rows[0].n,
    before + 1,
  );
  const saved = (
    await db.pool.query("SELECT * FROM zc_sga_intake WHERE id=$1", [entry.id])
  ).rows[0];
  assert.equal(saved.order_id, first.id);
  assert.deepEqual(saved.raw_source, entry.raw_source);
});

test("nome e chassi iguais não duplicam a entrada quando o SGA retorna outro código ou placa", async () => {
  overrides["910"] = { chassis: "CHASSIFICTICIO0910" };
  overrides["911"] = {
    chassis: "CHASSIFICTICIO0910",
    customer_name: data("910").customer_name,
  };
  movements = [movement("910"), movement("911")];
  const result = await run();
  assert.equal(result.summary.imported, 1);
  assert.equal(result.summary.duplicates, 1);
  assert.equal(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM zc_sga_intake WHERE sga_vehicle_id IN ('910','911')",
      )
    ).rows[0].n,
    1,
  );
});

test("falha parcial pode ser repetida sem perder ou duplicar cadastros recebidos", async () => {
  let failFirst = true;
  const flaky = {
    ...client,
    lookup: async (query) => {
      if (query.sga_id === "913" && failFirst) throw Error("Indisponível");
      return data(query.sga_id);
    },
  };
  movements = [movement("913"), movement("914")];
  const task = await intake.enqueue(db.pool, flaky, "Administrador");
  await intake.runCycle(db.pool, cfg, { client: flaky });
  let result = (
    await db.pool.query("SELECT * FROM zc_sga_intake_runs WHERE id=$1", [
      task.id,
    ])
  ).rows[0];
  assert.equal(result.state, "failed");
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.imported, 1);
  assert.equal(result.summary.errors[0].sga_id, "913");
  assert.equal(result.summary.errors[0].stage, "consulta do veículo");
  failFirst = false;
  await db.pool.query(
    "UPDATE zc_sga_intake_runs SET available_at=0 WHERE id=$1",
    [task.id],
  );
  await intake.runCycle(db.pool, cfg, { client: flaky });
  result = (
    await db.pool.query("SELECT * FROM zc_sga_intake_runs WHERE id=$1", [
      task.id,
    ])
  ).rows[0];
  assert.equal(result.state, "completed");
  assert.equal(result.attempts, 2);
  assert.equal(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM zc_sga_intake WHERE sga_vehicle_id IN ('913','914')",
      )
    ).rows[0].n,
    2,
  );
});
test("agendamento diário usa Brasília, não executa antes do horário e é único por dia", async (t) => {
  const previousConfig = await intake.configuration(db.pool);
  t.after(async () => {
    const current = await intake.configuration(db.pool);
    config = await intake.saveConfiguration(db.pool, client, { ...previousConfig, version: current.version }, "Administrador");
  });
  config = await intake.saveConfiguration(
    db.pool,
    client,
    { ...config, enabled: true, daily_time: "10:00" },
    "Administrador",
  );
  const before = await intake.enqueue(db.pool, client, "Scheduler", {
    automatic: true,
    now: new Date("2026-11-16T12:59:00Z"),
  });
  assert.equal(before, null);
  const tasks = await Promise.all([
    intake.enqueue(db.pool, client, "Scheduler", {
      automatic: true,
      now: new Date("2026-11-16T13:00:00Z"),
    }),
    intake.enqueue(db.pool, client, "Scheduler", {
      automatic: true,
      now: new Date("2026-11-16T13:01:00Z"),
    }),
  ]);
  assert.equal(tasks.filter(Boolean).length, 1);
  assert.equal(tasks.find(Boolean).day, "2026-11-16");
  assert.equal(intake.movementDay("2026-11-17T01:30:00Z"), "2026-11-16");
  assert.equal(intake.movementDay("2026-11-16 23:59:00"), "2026-11-16");
  assert.equal(intake.movementDay("inválido"), "");
  await assert.rejects(
    intake.saveConfiguration(
      db.pool,
      client,
      { ...config, pending_code: "999" },
      "Teste",
    ),
    /catálogo/,
  );
  await assert.rejects(
    intake.saveConfiguration(
      db.pool,
      client,
      { ...config, daily_time: "29:00" },
      "Teste",
    ),
    /horário/,
  );
});
test("produtos são do veículo certo; inativo e indisponível não confirmam Perfurado", () => {
  assert.throws(
    () => productsSnapshot({ codigo_veiculo: "2", produtos: [] }, "1"),
    /correspondem/,
  );
  assert.equal(
    productsSnapshot(
      {
        codigo_veiculo: "1",
        produtos: [
          {
            codigo_produto: "2371",
            descricao: "Perfurado",
            situacao: "INATIVO",
          },
        ],
      },
      "1",
    ).perfurado,
    false,
  );
  assert.equal(
    productsSnapshot(
      {
        codigo_veiculo: "1",
        produtos: [
          { codigo_produto: "2371", descricao: "Perfurado", situacao: "" },
        ],
      },
      "1",
    ).perfurado,
    null,
  );
  assert.equal(
    productsSnapshot(
      {
        codigo_veiculo: "1",
        produtos: [],
        produtos_adicionais: [
          { codigo_produto_adicional: "2371", situacao: "A" },
        ],
      },
      "1",
    ).perfurado,
    false,
  );
});
test("cliente SGA usa paginação do histórico e endpoint de produtos documentados sem escrita externa", async (t) => {
  const original = global.fetch,
    calls = [];
  global.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: options.body ? JSON.parse(options.body) : null });
    let result;
    if (path === "/usuario/autenticar")
      result = { token_usuario: "fake-user-token" };
    else if (path === "/listar/alteracao-veiculos")
      result = {
        resultado: [
          movement(String(900 + JSON.parse(options.body).inicio_paginacao)),
        ],
        numero_paginas: 2,
      };
    else if (path === "/veiculo/buscar/901/id")
      result = {
        codigo_veiculo: "901",
        placa: "SGA0901",
        nome: "Exemplo",
        codigo_classificacao: "42",
        campo_futuro: "preservar",
        token: "não persistir",
      };
    else if (path === "/produto-vinculado-veiculo/listar/901")
      result = {
        codigo_veiculo: "901",
        produtos: [
          { codigo_produto: "2371", descricao: "Perfurado", situacao: "ATIVO" },
        ],
      };
    else result = [];
    return new Response(JSON.stringify(result), { status: 200 });
  };
  t.after(() => {
    global.fetch = original;
  });
  const adapter = new SGAClient({
    ...cfg,
    SGA_SCHEDULING_GUARD: false,
    INTEGRATIONS_ENABLED: false,
    HINOVA_API_URL: "https://sga.example.test",
    HINOVA_TOKEN_ASSOC: "fake",
    HINOVA_USER: "fake",
    HINOVA_PASS: "fake",
  });
  const events = await adapter.pendingMovements(
    "2026-11-16",
    "classifications",
    "42",
  );
  assert.equal(events.length, 2);
  const requests = calls.filter((x) => x.path === "/listar/alteracao-veiculos");
  assert.deepEqual(
    requests.map((x) => x.body.inicio_paginacao),
    [0, 1],
  );
  assert.equal(requests[0].body.data_inicial, "16/11/2026");
  assert.deepEqual(requests[0].body.campos, ["codigo_classificacao"]);
  const mapped = await adapter.lookup({ sga_id: "901" }, { includeRaw: true });
  assert.equal(mapped.sga_products.perfurado, true);
  assert.equal(mapped.raw_vehicle.campo_futuro, "preservar");
  assert.equal(mapped.raw_vehicle.token, undefined);
  assert.ok(
    calls.every(
      (x) =>
        x.path === "/usuario/autenticar" ||
        x.path === "/listar/alteracao-veiculos" ||
        !x.body,
    ),
  );
});
test("rotas reservam configuração e coleta ao administrador e impedem acesso técnico aos dados brutos", async () => {
  const app = createApp(db.pool, {
    NODE_ENV: "test",
    APP_PASSWORD: "Intake1!teste",
    SESSION_SECRET: cfg.SESSION_SECRET,
    ZEN_WEBHOOK_SECRET: "test-only-webhook-intake-secret-1234567890",
  });
  await app.locals.ready();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const tokens = {};
    for (const role of ["admin", "operador", "tecnico"]) {
      const login = role === "admin" ? "admin" : "intake-" + role;
      if (role !== "admin")
        await db.pool.query(
          "INSERT INTO usuarios(login,nome,senha_hash,papel) VALUES($1,$1,$2,$3)",
          [login, await hashPassword("Intake1!teste"), role],
        );
      if (role === "tecnico") {
        const user = (
          await db.pool.query("SELECT id FROM usuarios WHERE login=$1", [login])
        ).rows[0];
        await db.pool.query(
          "INSERT INTO zc_technician_accounts(user_id,technician_id) VALUES($1,$2)",
          [user.id, tech],
        );
      }
      // Staff and technician sessions use their corresponding audiences.
      const response = await fetch(
        "http://127.0.0.1:" + server.address().port + "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            login,
            password: "Intake1!teste",
            audience: role === "tecnico" ? "technician" : "central",
          }),
        },
      );
      const body = await response.json();
      tokens[role] = body.token;
    }
    const get = (path, role, method = "GET", body) =>
      fetch("http://127.0.0.1:" + server.address().port + path, {
        method,
        headers: {
          Authorization: "Bearer " + tokens[role],
          "Content-Type": "application/json",
        },
        body: body && JSON.stringify(body),
      });
    assert.equal(
      (await get("/api/sga-intake/config", "operador", "PUT", {})).status,
      403,
    );
    assert.equal(
      (
        await get("/api/sga-intake/runs", "operador", "POST", {
          confirmed: true,
        })
      ).status,
      403,
    );
    assert.equal((await get("/api/sga-intake/entries", "tecnico")).status, 403);
    assert.equal(
      (await get("/api/sga-intake/entries", "operador")).status,
      200,
    );
    assert.equal(
      (await get("/api/sga-intake/runs", "admin", "POST", {})).status,
      400,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("período inclusivo, limite e datas futuras", () => {
 assert.deepEqual(intake.periodDays("2026-11-14", "2026-11-16", "2026-11-16"), ["2026-11-14","2026-11-15","2026-11-16"]);
 assert.throws(() => intake.periodDays("2026-11-16","2026-11-17","2026-11-16"));
 assert.throws(() => intake.periodDays("2026-10-01","2026-11-16","2026-11-16"));
 assert.equal(intake.movementDay("16/11/2026 09:30:00"),"2026-11-16");
});
test("FIPE alta requer dois equipamentos; elétrico exige consulta", () => {
 const vehicle = { ...data("999"), fipe_value: "R$ 95.000,00" };
 assert.deepEqual(intake.equipmentForIntake(vehicle,{electric:"no"}).equipment_counts,{tracker:1,tag:1});
 assert.throws(() => intake.equipmentForIntake(vehicle,{electric:"yes"}), /Consulte o cliente/);
 assert.deepEqual(intake.equipmentForIntake(vehicle,{electric:"yes",customer_choice:"tag_only"}).equipment_counts,{tracker:0,tag:1});
});

test("coleta manual retroativa ignora duplicidade e preserva as entradas", async () => {
  const previous = new Date(Date.parse(day + "T12:00:00Z") - 86400000).toISOString().slice(0,10);
  const historical = { ...client, pendingMovements: async (date) => date === previous ? [movement("998", {data_alteracao: previous + "T10:00:00-0300"})] : [] };
  const task = await intake.enqueue(db.pool,historical,"Administrador",{start:previous,end:day,complementary:false});
  assert.equal(await intake.runCycle(db.pool,cfg,{client:historical}), true);
  const row = (await db.pool.query("SELECT * FROM zc_sga_intake_runs WHERE id=$1",[task.id])).rows[0];
  assert.equal(row.state, "completed", row.message || "A coleta manual precisa ter sido executada.");
  assert.equal(row.summary.imported,1);
  const original = await d.one(db.pool, "SELECT * FROM zc_sga_intake WHERE sga_vehicle_id=$1", ["998"]);
  assert.ok(original);
  assert.equal(original.order_id, null);
  const second = await intake.enqueue(db.pool,historical,"Administrador",{start:previous,end:day});
  assert.equal(await intake.runCycle(db.pool,cfg,{client:historical}), true);
  const dup = (await db.pool.query("SELECT * FROM zc_sga_intake_runs WHERE id=$1",[second.id])).rows[0];
  assert.equal(dup.state, "completed", dup.message || "A segunda coleta precisa ter sido executada.");
  assert.equal(dup.summary.duplicates,1);
  assert.equal(dup.summary.imported,0);
  assert.deepEqual(await d.one(db.pool, "SELECT * FROM zc_sga_intake WHERE sga_vehicle_id=$1", ["998"]), original);
});

test("HTTP 406 na busca por código permite fallback por chassi e placa, sem aceitar outro código", async () => {
  const chassis = "9BWZZZ377VT004251", plate = "QAT1A23";
  const attempts = [];
  const fallback = {
    ...client,
    pendingMovements: async () => [
      movement("996", { chassi: chassis, placa: plate }),
      movement("997", { placa: "QAT1A24" }),
    ],
    lookup: async (query) => {
      attempts.push(query);
      if (query.sga_id || query.chassis) {
        const error = new Error("Filtro não aceito");
        error.upstreamStatus = 406;
        throw error;
      }
      return { ...data(query.term === plate ? "996" : "995"), vehicle: query.term };
    },
  };
  const task = await intake.enqueue(db.pool, fallback, "Administrador", { complementary: false });
  assert.equal(await intake.runCycle(db.pool, cfg, { client: fallback }), true);
  const result = await d.one(db.pool, "SELECT * FROM zc_sga_intake_runs WHERE id=$1", [task.id]);
  assert.equal(result.summary.imported, 1);
  assert.equal(result.summary.failed, 1);
  assert.match(result.summary.errors[0].message, /divergente/);
  assert.deepEqual(attempts, [{ sga_id: "996" }, { chassis }, { term: plate }, { sga_id: "997" }, { term: "QAT1A24" }]);
  assert.equal((await d.one(db.pool, "SELECT * FROM zc_sga_intake WHERE sga_vehicle_id=$1", ["996"])).order_id, null);
  assert.equal(await d.one(db.pool, "SELECT * FROM zc_sga_intake WHERE sga_vehicle_id=$1", ["995"]), undefined);
});
