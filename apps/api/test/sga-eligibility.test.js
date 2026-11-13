const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict");
const { testDatabase } = require("./helpers/database.cjs"),
  { migrate } = require("../scripts/migrate"),
  o = require("../src/orders");
const policy = require("../src/sga-eligibility"),
  { orderDocument } = require("../src/order-document");
let db, tech;
const cfg = {
  SGA_SCHEDULING_GUARD: true,
  SESSION_SECRET: "test-only-eligibility-secret-1234567890123456",
};
const state = {
  vehicle_status: "ATIVO",
  vehicle_classification: "INSTALAÇÃO PENDENTE",
  customer_status: "ATIVO",
  customer_classification: "ASSOCIADO",
  financial_status: "ADIMPLENTE",
};
const input = () => ({
  vehicle: "SGA1A23",
  customer_name: "Associado fictício",
  service: "Instalação",
  technician_id: tech,
  scheduled_at: "2026-12-02T10:00",
  sticker_discount_opt_in: true,
});
const check = (changes) =>
  policy.snapshot({
    vehicle: "SGA1A23",
    customer_name: "Associado fictício",
    sga_id: "42",
    sga_assessment: { ...state, ...changes },
  });
before(async () => {
  db = await testDatabase();
  await migrate(db.pool);
  tech = (
    await db.pool.query(
      "INSERT INTO zc_technicians(name) VALUES('Técnico fictício') RETURNING id",
    )
  ).rows[0].id;
});
after(async () => db.close());
test("agendamento exige situação consultada e assinada pelo servidor; campos do navegador não liberam", async () => {
  await assert.rejects(
    o.create(
      db.pool,
      { ...input(), sga_check: check(), sga_status: "ATIVO" },
      "Teste",
      cfg,
    ),
    /Consulte/,
  );
  const good = check();
  const saved = await o.create(
    db.pool,
    { ...input(), sga_verification: policy.sign(good, cfg.SESSION_SECRET) },
    "Teste",
    cfg,
  );
  assert.equal(saved.status, "AGENDADO");
  assert.equal(saved.sga_check.assessment.financial_status, "ADIMPLENTE");
  assert.equal(saved.sticker_discount_opt_in, true);
  assert.match(orderDocument(saved, false).instructions, /ADESIVO PERFURADO/);
  assert.match(orderDocument(saved, false).instructions, /2371/);
  await assert.rejects(
    o.create(
      db.pool,
      {
        ...input(),
        sga_verification: policy.sign(good, cfg.SESSION_SECRET) + "a",
      },
      "Teste",
      cfg,
    ),
    /inválida/,
  );
});
test("inadimplência, inatividade e resposta incompleta bloqueiam; rascunho continua permitido", async () => {
  for (const change of [
    { financial_status: "INADIMPLENTE" },
    { customer_status: "INATIVO" },
    { vehicle_status: "CANCELADO" },
    { financial_status: "" },
  ]) {
    const verification = policy.sign(check(change), cfg.SESSION_SECRET);
    await assert.rejects(
      o.create(
        db.pool,
        { ...input(), sga_verification: verification },
        "Teste",
        cfg,
      ),
      /Agendamento bloqueado/,
    );
    const draft = await o.create(
      db.pool,
      {
        ...input(),
        scheduled_at: "",
        status: "PENDENTE",
        sga_verification: verification,
      },
      "Teste",
      cfg,
    );
    assert.equal(draft.status, "PENDENTE");
  }
});
test("validação vencida ou de outro veículo não libera, e reagendamento reavalia restrições", async () => {
  const expired = {
    ...check(),
    verified_at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
  };
  assert.throws(() => policy.assertEligible(expired, input()), /Consulte/);
  assert.throws(
    () => policy.assertEligible(check(), { ...input(), vehicle: "OUT1A23" }),
    /Consulte/,
  );
  const saved = await o.create(
    db.pool,
    { ...input(), sga_verification: policy.sign(check(), cfg.SESSION_SECRET) },
    "Teste",
    cfg,
  );
  await assert.rejects(
    o.edit(
      db.pool,
      saved.id,
      {
        version: saved.version,
        scheduled_at: "2026-12-03T10:00",
        sga_verification: policy.sign(
          check({ financial_status: "INADIMPLENTE" }),
          cfg.SESSION_SECRET,
        ),
      },
      "Teste",
      cfg,
    ),
    /Agendamento bloqueado/,
  );
  assert.equal(
    (await o.get(db.pool, saved.id)).scheduled_at,
    "2026-12-02T10:00",
  );
});

test("nova consulta indisponível remove comprovação anterior da revisão importada", () => {
  const { completeRow } = require("../src/sga-enrichment");
  const row = {
    state: "ready",
    data: { ...input(), sga_check: check() },
    inference: [],
  };
  const updated = completeRow(row, {
    status: "unavailable",
    message: "SGA indisponível",
  });
  assert.equal(updated.data.sga_check, undefined);
  assert.equal(updated.data.customer_name, row.data.customer_name);
});
