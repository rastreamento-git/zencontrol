const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { testDatabase } = require("./helpers/database.cjs"),
  { migrate } = require("../scripts/migrate"),
  { createApp } = require("../src/app");
const d = require("../src/domain"),
  f = require("../src/finance-engine"),
  cal = require("../src/financial-calendar"),
  o = require("../src/orders"),
  { transaction } = require("../src/database");
const { prepareBackup, restoreBackup, tables } = require("../src/backup");
let db,
  pool,
  server,
  base,
  admin,
  tech,
  other,
  tid,
  otherId,
  folder,
  config,
  access;
const password = "Zen1!abc",
  secret = "homologation-test-only-secret-123456789012345";
async function req(route, method = "GET", body, token = admin) {
  const r = await fetch(base + "/api" + route, {
    method: method || "GET",
    headers: {
      Authorization: "Bearer " + token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
async function ok(route, method, body, token, expected = 200) {
  const r = await req(route, method, body, token);
  assert.equal(r.status, expected, JSON.stringify(r.data));
  return r.data;
}
before(async () => {
  db = await testDatabase();
  pool = db.pool;
  await migrate(pool);
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "zen-ecosystem-"));
  config = require("../src/config").configuration({
    NODE_ENV: "test",
    APP_PASSWORD: password,
    SESSION_SECRET: secret,
    ZEN_WEBHOOK_SECRET: secret,
    ZEN_DATA_DIR: folder,
  });
  const app = createApp(pool, config);
  await app.locals.ready();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
  admin = (await ok("/auth/login", "POST", { login: "admin", password })).token;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});
test("A: automatic normalized unique login; activation cannot release data before a strong password; one-use code and tenant isolation", async () => {
  const a = await ok("/technicians", "POST", {
    name: "José da Silva Martins",
    price_install: "90",
    price_maintenance: "50",
    price_removal: "40",
    price_visit: "30",
  });
  tid = a.id;
  access = a.access;
  assert.equal(access.login, "jose.martins");
  const b = await ok("/technicians", "POST", { name: "José Martins" });
  otherId = b.id;
  assert.equal(b.access.login, "jose.martins2");
  assert.equal(
    (
      await req("/auth/login", "POST", {
        login: access.login,
        password: "zen123",
      })
    ).status,
    401,
  );
  assert.equal(
    (await req("/technician/orders", "GET", null, "zen123")).status,
    401,
  );
  assert.equal(
    (
      await req("/auth/activate", "POST", {
        login: access.login,
        password: "zen123",
        code: "wrong",
        new_password: password,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await req("/auth/activate", "POST", {
        login: access.login,
        password: "zen123",
        code: access.code,
        new_password: "short",
      })
    ).status,
    400,
  );
  await ok("/auth/activate", "POST", {
    login: access.login,
    password: "zen123",
    code: access.code,
    new_password: password,
  });
  assert.equal(
    (
      await req("/auth/activate", "POST", {
        login: access.login,
        password: "zen123",
        code: access.code,
        new_password: password,
      })
    ).status,
    401,
  );
  tech = (
    await ok("/auth/login", "POST", {
      login: access.login,
      password,
      audience: "technician",
    })
  ).token;
  await ok("/auth/activate", "POST", {
    login: b.access.login,
    password: "zen123",
    code: b.access.code,
    new_password: password,
  });
  other = (
    await ok("/auth/login", "POST", {
      login: b.access.login,
      password,
      audience: "technician",
    })
  ).token;
  assert.equal((await req("/technicians", "GET", null, tech)).status, 403);
  const events = await d.rows(pool, "SELECT event FROM zc_auth_events");
  assert.ok(events.some((x) => x.event === "activation_failed"));
  assert.ok(events.some((x) => x.event === "activated"));
});
test("B/C: internal distribution, persistent deduplication, separate readers, calendar update and correction notification", async () => {
  const order = await ok(
    "/orders",
    "POST",
    {
      service: "Instalação",
      customer_name: "Cliente fictício",
      vehicle: "ZEN1A23",
      technician_id: tid,
      scheduled_at: d.today() + "T10:00",
    },
    admin,
    201,
  );
  let inbox = await ok("/notifications", null, null, tech);
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.unread, 1);
  assert.equal(inbox.items[0].detail.order_id, order.id);
  await ok(
    "/orders/" + order.id + "/dispatch",
    "POST",
    { masked: true },
    admin,
    202,
  );
  inbox = await ok("/notifications", null, null, tech);
  assert.equal(inbox.items.length, 1);
  assert.equal((await ok("/notifications", null, null, other)).items.length, 0);
  assert.equal(
    (
      await req(
        "/notifications/" + inbox.items[0].id + "/read",
        "POST",
        {},
        other,
      )
    ).status,
    404,
  );
  await ok("/notifications/" + inbox.items[0].id + "/read", "POST", {}, tech);
  assert.equal((await ok("/notifications", null, null, tech)).unread, 0);
  assert.equal(
    (await req("/technician/orders/" + order.id, "GET", null, other)).status,
    404,
  );
  assert.equal(
    (
      await ok(
        "/technician/orders?vehicle=ZEN1&from=" + d.today(),
        null,
        null,
        tech,
      )
    ).total,
    1,
  );
  const updated = await o.edit(
    pool,
    order.id,
    { version: order.version, scheduled_at: d.today() + "T15:00" },
    "Teste",
  );
  assert.equal(updated.version, order.version + 1);
  assert.ok(
    (await ok("/notifications", null, null, tech)).items.some(
      (n) => n.title === "Ordem de serviço atualizada",
    ),
  );
  assert.equal(
    Number(
      (
        await d.one(
          pool,
          "SELECT count(*) n FROM zc_jobs WHERE kind='dispatch'",
        )
      ).n,
    ),
    0,
  );
});
let historic, closing, second;
async function eligibleOrder(executedOn, eligibleOn = d.today()) {
  const order = await o.create(
    pool,
    {
      service: "Instalação",
      customer_name: "Cliente fictício",
      vehicle: "ZEN1A23",
      technician_id: tid,
    },
    "Teste",
  );
  await transaction(pool, async (tx) => {
    await f.capture(tx, order, executedOn);
    await tx.query(
      "UPDATE zc_orders SET executed_on=$2,status='CONCLUÍDO',completed_at=$3 WHERE id=$1",
      [order.id, executedOn, eligibleOn],
    );
    await f.makeEligible(tx, { ...order, executed_on: executedOn });
    await tx.query(
      "UPDATE zc_financial_ledger SET eligible_on=$2 WHERE order_id=$1",
      [order.id, eligibleOn],
    );
  });
  return order;
}
test("E/G: versioned rates preserve old execution, request cannot self-approve; counteroffer requires technician acceptance", async () => {
  historic = await eligibleOrder(
    cal.add(d.today(), -8),
    cal.add(d.today(), -7),
  );
  const initial = (await ok("/technician/rates", null, null, tech)).items[0]
      .prices,
    proposed = { ...initial, Instalação: 11000 };
  const r = await ok(
    "/technician/requests",
    "POST",
    {
      kind: "rate",
      proposed: { prices: proposed, effective_on: d.today() },
      reason: "Revisão de deslocamento",
      request_key: randomUUID(),
    },
    tech,
    201,
  );
  assert.equal(
    (
      await req(
        "/requests/" + r.id + "/decision",
        "POST",
        { version: 1, action: "approve", reason: "Aprovar" },
        tech,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req(
        "/technician/requests/" + r.id + "/respond",
        "POST",
        { version: 1, action: "accept", reason: "Aceito" },
        other,
      )
    ).status,
    404,
  );
  await ok("/requests/" + r.id + "/decision", "POST", {
    version: 1,
    action: "counteroffer",
    reason: "Proposta intermediária",
    proposed: {
      effective_on: d.today(),
      prices: { ...initial, Instalação: 10000 },
    },
  });
  assert.equal(
    (
      await d.one(
        pool,
        "SELECT count(*)::int n FROM zc_rates WHERE technician_id=$1",
        [tid],
      )
    ).n,
    1,
  );
  await ok(
    "/technician/requests/" + r.id + "/respond",
    "POST",
    { version: 2, action: "accept", reason: "Concordo com a contraproposta" },
    tech,
  );
  second = await eligibleOrder(d.today());
  assert.equal(
    (
      await d.one(
        pool,
        "SELECT base_cents FROM zc_financial_ledger WHERE order_id=$1",
        [historic.id],
      )
    ).base_cents,
    9000,
  );
  assert.equal(
    (
      await d.one(
        pool,
        "SELECT base_cents FROM zc_financial_ledger WHERE order_id=$1",
        [second.id],
      )
    ).base_cents,
    10000,
  );
  assert.equal(
    (
      await req(
        "/technician/requests/" + r.id + "/respond",
        "POST",
        { version: 2, action: "accept", reason: "repetido" },
        tech,
      )
    ).status,
    409,
  );
});
test("E/F/H: effective policies, immutable closing, idempotency, late approval includes original competence once", async () => {
  await ok("/finance-v2/technicians/" + tid + "/policy", "PUT", {
    version: 0,
    policy: {
      unit: "days",
      every: 14,
      anchor: cal.add(d.today(), -20),
      due_days: 2,
    },
  });
  assert.equal(
    (await ok("/technician/finance", null, null, tech)).cycle.policy.every,
    14,
  );
  const start = cal.add(d.today(), -13),
    end = d.today(),
    p = await ok(
      "/finance-v2/preview?technician_id=" +
        tid +
        "&start=" +
        start +
        "&end=" +
        end,
    );
  assert.equal(p.total_cents, 19000);
  const legacy = await ok(
    "/finance/preview?technician_id=" +
      tid +
      "&start=2020-01-01&end=2099-12-31",
  );
  assert.equal(
    (
      await req("/finance/settlements", "POST", {
        technician_id: tid,
        start: "2020-01-01",
        end: "2099-12-31",
        expected_total: legacy.total_cents,
        order_ids: legacy.orders.map((x) => x.id),
      })
    ).status,
    409,
  );
  const body = {
    technician_id: tid,
    start,
    end,
    preview_hash: p.preview_hash,
    extraordinary: true,
    reason: "Fechamento fictício autorizado",
    request_key: randomUUID(),
  };
  closing = await ok("/finance-v2/closings", "POST", body, admin, 201);
  const retry = await ok("/finance-v2/closings", "POST", body, admin, 201);
  assert.equal(retry.id, closing.id);
  const stale = await req("/finance-v2/closings", "POST", {
    ...body,
    request_key: randomUUID(),
  });
  assert.ok([400, 409].includes(stale.status));
  assert.equal(
    (
      await req("/finance-v2/closings/" + closing.id + "/payments", "POST", {
        amount_cents: 1,
        paid_on: d.today(),
        reference: "Antes da aprovação",
        request_key: randomUUID(),
      })
    ).status,
    409,
  );
  await ok("/finance-v2/closings/" + closing.id + "/approve", "POST", {});
  const before = JSON.stringify(
    (
      await d.one(pool, "SELECT snapshot FROM zc_settlements WHERE id=$1", [
        closing.id,
      ])
    ).snapshot,
  );
  const late = await eligibleOrder(cal.add(d.today(), -40));
  const next = await ok(
    "/finance-v2/preview?technician_id=" +
      tid +
      "&start=" +
      start +
      "&end=" +
      end,
  );
  assert.equal(next.orders.length, 1);
  assert.equal(next.orders[0].id, late.id);
  assert.equal(next.orders[0].late, true);
  assert.equal(next.orders[0].base_cents, 9000);
  assert.equal(
    JSON.stringify(
      (
        await d.one(pool, "SELECT snapshot FROM zc_settlements WHERE id=$1", [
          closing.id,
        ])
      ).snapshot,
    ),
    before,
  );
  assert.equal(
    (await req("/finance-v2/technicians/" + tid, "GET", null, other)).status,
    403,
  );
});
test("I/J: partial and full external payments, retry identity, overpayment protection, cross-technician demonstrative isolation", async () => {
  const pdf = await require("pdf-lib").PDFDocument.create();
  pdf.addPage().drawText("COMPROVANTE FICTICIO - SEM PAGAMENTO REAL");
  const proof = Buffer.from(await pdf.save());
  const input = {
    receipt: "data:application/pdf;base64," + proof.toString("base64"),
    amount_cents: 7000,
    paid_on: d.today(),
    reference: "SIMULADO-SEM-BANCO-001",
    request_key: randomUUID(),
  };
  const first = await ok(
    "/finance-v2/closings/" + closing.id + "/payments",
    "POST",
    input,
    admin,
    201,
  );
  const same = await ok(
    "/finance-v2/closings/" + closing.id + "/payments",
    "POST",
    input,
    admin,
    201,
  );
  assert.equal(first.id, same.id);
  assert.equal(
    (
      await req("/finance-v2/closings/" + closing.id + "/payments", "POST", {
        ...input,
        amount_cents: 7001,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await req("/finance-v2/closings/" + closing.id + "/payments", "POST", {
        ...input,
        request_key: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await req("/finance-v2/closings/" + closing.id + "/payments", "POST", {
        ...input,
        request_key: randomUUID(),
        amount_cents: 20000,
      })
    ).status,
    409,
  );
  let s = (await ok("/technician/finance", null, null, tech)).settlements[0];
  assert.equal(s.state, "partial");
  assert.equal(s.balance_cents, 12000);
  await ok(
    "/finance-v2/closings/" + closing.id + "/payments",
    "POST",
    {
      ...input,
      request_key: randomUUID(),
      amount_cents: 12000,
      reference: "SIMULADO-SEM-BANCO-002",
    },
    admin,
    201,
  );
  s = (await ok("/technician/finance", null, null, tech)).settlements[0];
  assert.equal(s.state, "paid");
  assert.equal(s.balance_cents, 0);
  assert.equal(s.payments.length, 2);
  assert.equal(
    (
      await req(
        "/finance-v2/closings/" + closing.id + "/export",
        "GET",
        null,
        other,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await req(
        "/finance-v2/closings/" + closing.id + "/export",
        "GET",
        null,
        tech,
      )
    ).status,
    200,
  );
  const reconcile = await ok("/finance-v2/reconcile");
  assert.deepEqual(reconcile.invalid_closings, []);
});
test("specific-order dispute creates an adjustment in the next eligible closing; closed composition remains unchanged", async () => {
  const r = await ok(
    "/technician/requests",
    "POST",
    {
      kind: "dispute",
      order_id: historic.id,
      reason: "Adicional de deslocamento",
      proposed: { amount_cents: 1500 },
      request_key: randomUUID(),
    },
    tech,
    201,
  );
  const before = JSON.stringify(
    (
      await d.one(pool, "SELECT snapshot FROM zc_settlements WHERE id=$1", [
        closing.id,
      ])
    ).snapshot,
  );
  await ok("/requests/" + r.id + "/decision", "POST", {
    version: 1,
    action: "approve",
    reason: "Adicional conferido",
  });
  const p = await ok(
    "/finance-v2/preview?technician_id=" +
      tid +
      "&start=" +
      cal.add(d.today(), -6) +
      "&end=" +
      d.today(),
  );
  assert.equal(p.carry_adjustments.length, 1);
  assert.equal(p.carry_adjustments[0].amount_cents, 1500);
  assert.equal(
    JSON.stringify(
      (
        await d.one(pool, "SELECT snapshot FROM zc_settlements WHERE id=$1", [
          closing.id,
        ])
      ).snapshot,
    ),
    before,
  );
});
test("confirmed totals include pending approved adjustments and remain correct beyond display pagination", async () => {
  const own = await f.summary(pool, tid);
  assert.equal(own.confirmed_cents, 10500);
  const t = await o.insert(pool, "zc_technicians", {
    name: "Agregação fictícia",
    price_install: 100,
  });
  try {
    const rate = await f.initialRate(pool, t);
    await pool.query(
      "INSERT INTO zc_orders(id,technician_id,service,vehicle,status,executed_on,workflow_mode,created_date,updated_at) SELECT 'AGGREGATE-'||n,$1,'Instalação','HOM1A23','CONCLUÍDO',$2,'controlled',$2,$2 FROM generate_series(1,1001) n",
      [t.id, d.today()],
    );
    await pool.query(
      "INSERT INTO zc_financial_ledger(order_id,technician_id,executed_on,rate_id,base_cents,total_cents,state,eligible_on) SELECT id,$1,$2,$3,100,100,'approved',$2 FROM zc_orders WHERE technician_id=$1",
      [t.id, d.today(), rate.id],
    );
    const totals = await f.summary(pool, t.id);
    assert.equal(totals.ledger.length, 1000);
    assert.equal(totals.confirmed_cents, 100100);
  } finally {
    await transaction(pool, async (tx) => {
      await tx.query("DELETE FROM zc_financial_ledger WHERE technician_id=$1", [
        t.id,
      ]);
      await tx.query("DELETE FROM zc_orders WHERE technician_id=$1", [t.id]);
      await tx.query("DELETE FROM zc_rates WHERE technician_id=$1", [t.id]);
      await tx.query("DELETE FROM zc_technicians WHERE id=$1", [t.id]);
    });
  }
});
test("zero-valued authorized closing ends without creating a fictitious money transfer", async () => {
  const order = await o.create(
    pool,
    {
      service: "Visita",
      customer_name: "Cliente fictício zero",
      vehicle: "ZER1A23",
      technician_id: otherId,
    },
    "Teste",
  );
  await transaction(pool, async (tx) => {
    await f.capture(tx, order, d.today());
    await tx.query("UPDATE zc_orders SET status='CONCLUÍDO' WHERE id=$1", [
      order.id,
    ]);
    await f.makeEligible(tx, { ...order, executed_on: d.today() });
  });
  const p = await f.preview(pool, otherId, d.today(), d.today());
  assert.equal(p.total_cents, 0);
  const c = await transaction(pool, (tx) =>
    f.createClosing(
      tx,
      {
        technician_id: otherId,
        start: d.today(),
        end: d.today(),
        preview_hash: f.digest(p),
        extraordinary: true,
        reason: "Valor zero conferido",
        request_key: randomUUID(),
      },
      "Teste",
    ),
  );
  const approved = await transaction(pool, (tx) =>
    f.approveClosing(tx, c.id, "Teste"),
  );
  assert.equal(approved.state, "no_payment_due");
  assert.equal(
    Number(
      (
        await d.one(
          pool,
          "SELECT count(*) n FROM zc_payments WHERE settlement_id=$1",
          [c.id],
        )
      ).n,
    ),
    0,
  );
});
test("J: reset invalidates sessions, expired activation refuses access, deactivation is immediate", async () => {
  const a = await ok("/technicians/" + tid + "/activation", "POST", {});
  assert.equal(
    (await req("/technician/finance", "GET", null, tech)).status,
    401,
  );
  await pool.query(
    "UPDATE zc_activations SET expires_at=now()-interval '1 minute' WHERE user_id IN(SELECT user_id FROM zc_technician_accounts WHERE technician_id=$1)",
    [tid],
  );
  assert.equal(
    (
      await req("/auth/activate", "POST", {
        login: a.login,
        password: "zen123",
        code: a.code,
        new_password: password,
      })
    ).status,
    401,
  );
  const row = await d.one(pool, "SELECT * FROM zc_technicians WHERE id=$1", [
    otherId,
  ]);
  await ok("/technicians/" + otherId, "PATCH", {
    version: row.version,
    active: false,
  });
  assert.equal(
    (await req("/technician/finance", "GET", null, other)).status,
    401,
  );
});
test("J: backup restores financial snapshots, rates, requests, notices and payments in an empty isolated database", async () => {
  const backup = await prepareBackup(pool, config),
    root = path.join(folder, "restore-case");
  await fs.mkdir(path.join(root, "media"), { recursive: true });
  await fs.writeFile(path.join(root, "database.json"), backup.database);
  await fs.writeFile(path.join(root, "manifest.json"), backup.manifest);
  for (const file of backup.files)
    await fs.copyFile(file.local, path.join(root, file.name));
  const target = await testDatabase(),
    targetCfg = { ...config, DATA_DIR: path.join(folder, "restored-media") };
  try {
    await migrate(target.pool);
    await restoreBackup(target.pool, targetCfg, root, true);
    assert.equal(
      Number(
        (await d.one(target.pool, "SELECT count(*) n FROM zc_payments")).n,
      ),
      2,
    );
    assert.equal(
      (
        await d.one(
          target.pool,
          "SELECT state FROM zc_settlements WHERE id=$1",
          [closing.id],
        )
      ).state,
      "paid",
    );
    assert.ok(
      Number(
        (await d.one(target.pool, "SELECT count(*) n FROM zc_notifications")).n,
      ) > 0,
    );
    const payment = await d.one(
      target.pool,
      "SELECT * FROM zc_payments WHERE receipt_path<>'' LIMIT 1",
    );
    assert.ok(payment);
    const bytes = await require("../src/media-store")
      .createMediaStore(targetCfg)
      .read(payment.receipt_path);
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    await fs.writeFile(
      path.join(root, "media", payment.receipt_path),
      "corrupted",
    );
    await assert.rejects(
      restoreBackup(target.pool, targetCfg, root),
      /integridade/,
    );
  } finally {
    await target.close();
    await backup.cleanup();
  }
});
