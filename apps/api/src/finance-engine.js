const { randomUUID, createHash } = require("node:crypto");
const d = require("./domain"),
  { fail } = require("./errors"),
  cal = require("./financial-calendar");
const { notify } = require("./notifications");
const pricesFrom = (t) => ({
  Instalação: t.price_install,
  Reinstalação: t.price_install,
  Manutenção: t.price_maintenance,
  Retirada: t.price_removal,
  Visita: t.price_visit,
  Improdutiva: t.price_visit,
});
function prices(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...d.services].sort().join() ||
    Object.values(value).some(
      (x) => !Number.isSafeInteger(x) || x < 0 || x > 100000000,
    )
  )
    fail(
      400,
      "Informe as seis tarifas em centavos inteiros, sem valores negativos.",
    );
  return value;
}
async function initialRate(db, t, actor = "system") {
  const previous = await d.one(
    db,
    "SELECT * FROM zc_rates WHERE technician_id=$1 ORDER BY effective_on LIMIT 1",
    [t.id],
  );
  if (previous) return previous;
  return (
    await db.query(
      "INSERT INTO zc_rates(id,technician_id,effective_on,prices,created_by) VALUES($1,$2,'1900-01-01',$3::jsonb,$4) RETURNING *",
      [randomUUID(), t.id, JSON.stringify(pricesFrom(t)), actor],
    )
  ).rows[0];
}
async function addRate(db, tid, proposal, actor) {
  const effective = cal.date(proposal.effective_on);
  prices(proposal.prices);
  // Rates may be future-dated. Backdating behind the authorization day is forbidden.
  if (effective < d.today())
    fail(400, "A vigência não pode anteceder a autorização.");
  if (!(await d.one(db, "SELECT 1 FROM zc_technicians WHERE id=$1", [tid])))
    fail(404, "Técnico não encontrado.");
  const id = randomUUID();
  await db.query(
    "INSERT INTO zc_rates(id,technician_id,effective_on,prices,created_by) VALUES($1,$2,$3,$4::jsonb,$5)",
    [id, tid, effective, JSON.stringify(proposal.prices), actor],
  );
  await d.audit(db, actor, "rate_authorized", "rate", id, {
    technician_id: tid,
    effective_on: effective,
    prices: proposal.prices,
  });
  await notify(
    db,
    "technician",
    tid,
    "rate:" + id,
    "Novas tarifas autorizadas",
    { effective_on: effective },
    "rates",
  );
  return id;
}
async function capture(db, order, executedOn) {
  cal.date(executedOn);
  if (order.tracker_waiver_authorized) return null;
  const existing = await d.one(
    db,
    "SELECT * FROM zc_financial_ledger WHERE order_id=$1",
    [order.id],
  );
  if (existing) {
    if (
      existing.executed_on !== executedOn ||
      existing.technician_id !== order.technician_id
    )
      fail(
        409,
        "A data e o técnico já possuem uma composição financeira. Solicite ajuste à central.",
      );
    return existing;
  }
  const t = await d.one(db, "SELECT * FROM zc_technicians WHERE id=$1", [
    order.technician_id,
  ]);
  if (!t) fail(409, "Vincule um técnico antes de calcular.");
  await initialRate(db, t);
  const r = await d.one(
    db,
    "SELECT * FROM zc_rates WHERE technician_id=$1 AND effective_on<=$2 ORDER BY effective_on DESC LIMIT 1",
    [t.id, executedOn],
  );
  if (!r) fail(409, "Nenhuma tarifa vigente para a data executada.");
  const service = d.services.find((x) => order.service.startsWith(x)),
    base = r.prices[service];
  if (!Number.isSafeInteger(base))
    fail(409, "Tarifa não configurada para este serviço.");
  const extras = await d.rows(
    db,
    "SELECT type,description,amount_cents FROM zc_order_extras WHERE order_id=$1 ORDER BY id",
    [order.id],
  );
  const total = base + extras.reduce((s, x) => s + x.amount_cents, 0);
  if (!Number.isSafeInteger(total) || total > 1e9)
    fail(400, "Composição acima do limite por serviço.");
  return (
    await db.query(
      "INSERT INTO zc_financial_ledger(order_id,technician_id,executed_on,rate_id,base_cents,extras,total_cents) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *",
      [order.id, t.id, executedOn, r.id, base, JSON.stringify(extras), total],
    )
  ).rows[0];
}
async function makeEligible(db, order) {
  if (order.workflow_mode !== "controlled" || order.tracker_waiver_authorized)
    return;
  await capture(
    db,
    order,
    order.executed_on || order.completed_at || d.today(),
  );
  await db.query(
    "UPDATE zc_financial_ledger SET state='approved',eligible_on=$2 WHERE order_id=$1 AND state<>'approved'",
    [order.id, d.today()],
  );
}
const defaultPolicy = () => ({
  unit: "weeks",
  every: 1,
  anchor: d.today(),
  due_days: 2,
  business_days: false,
  due_business_days: true,
});
async function policyFor(db, tid, on = d.today()) {
  const found = await d.one(
    db,
    "SELECT * FROM zc_closing_policies WHERE technician_id=$1",
    [tid],
  );
  const policy = found?.policy || defaultPolicy();
  const holidays = (await d.rows(db, "SELECT day FROM zc_holidays")).map(
    (x) => x.day,
  );
  const current = cal.period(policy, on, holidays),
    next = cal.period(policy, current.next_start, holidays);
  return { policy, version: found?.version || 0, current, next };
}
async function preview(db, tid, start, end) {
  cal.date(start);
  cal.date(end);
  if (start > end) fail(400, "Período invertido.");
  const t = await d.one(db, "SELECT * FROM zc_technicians WHERE id=$1", [tid]);
  if (!t) fail(404, "Técnico não encontrado.");
  const orders = await d.rows(
    db,
    "SELECT l.*,o.vehicle,o.service FROM zc_financial_ledger l JOIN zc_orders o ON o.id=l.order_id WHERE o.tracker_waiver_authorized=false AND l.technician_id=$1 AND l.state='approved' AND l.eligible_on<=$2 AND l.executed_on<=$2 AND o.status='CONCLUÍDO' AND o.deleted_at='' AND NOT EXISTS(SELECT 1 FROM zc_settlement_orders s WHERE s.order_id=l.order_id) ORDER BY l.executed_on,l.order_id",
    [tid, end],
  );
  for (const item of orders) {
    item.id = item.order_id;
    item.original_competence = item.executed_on.slice(0, 7);
    item.late = item.executed_on < start;
    item.adjustments = await d.rows(
      db,
      "SELECT * FROM zc_adjustments WHERE order_id=$1 AND settlement_id IS NULL ORDER BY created_at,id",
      [item.id],
    );
    item.total_cents += item.adjustments.reduce(
      (s, a) => s + a.amount_cents,
      0,
    );
    if (item.total_cents < 0) fail(409, "Ajustes deixariam uma OS negativa.");
  }
  const carry = await d.rows(
    db,
    "SELECT a.*,l.technician_id FROM zc_adjustments a JOIN zc_financial_ledger l ON l.order_id=a.order_id JOIN zc_orders o ON o.id=l.order_id WHERE o.tracker_waiver_authorized=false AND l.technician_id=$1 AND a.settlement_id IS NULL AND EXISTS(SELECT 1 FROM zc_settlement_orders s WHERE s.order_id=a.order_id) ORDER BY a.created_at,a.id",
    [tid],
  );
  const total =
    orders.reduce((s, x) => s + x.total_cents, 0) +
    carry.reduce((s, x) => s + x.amount_cents, 0);
  return {
    technician: { id: t.id, name: t.name },
    start,
    end,
    orders,
    carry_adjustments: carry,
    total_cents: total,
  };
}
const digest = (p) =>
  createHash("sha256").update(JSON.stringify(p)).digest("hex");
async function createClosing(db, input, actor) {
  const key = d.string(input.request_key, "Chave de confirmação", 160, true);
  if (key.length < 12) fail(400, "Chave de confirmação muito curta.");
  const previous = await d.one(
    db,
    "SELECT * FROM zc_settlements WHERE request_key=$1",
    [key],
  );
  if (previous) {
    if (
      previous.technician_id !== Number(input.technician_id) ||
      previous.start_date !== input.start ||
      previous.end_date !== input.end ||
      previous.snapshot.preview_hash !== input.preview_hash
    )
      fail(409, "Chave já utilizada com outros dados.");
    return previous;
  }
  const today = d.today();
  const pp = await policyFor(db, input.technician_id, input.end);
  if (
    !input.extraordinary &&
    (pp.current.start !== input.start || pp.current.end !== input.end)
  )
    fail(
      400,
      "O período deve seguir a política. Use fechamento extraordinário com justificativa.",
    );
  if (input.end > today) fail(400, "O período ainda não terminou.");
  const reason = input.extraordinary
    ? d.string(input.reason, "Justificativa extraordinária", 1000, true)
    : "";
  const p = await preview(db, input.technician_id, input.start, input.end);
  if (!p.orders.length && !p.carry_adjustments.length)
    fail(400, "Nenhum lançamento elegível.");
  if (p.total_cents < 0 || p.total_cents > 2e9)
    fail(400, "Total fora do limite permitido para um fechamento.");
  if (digest(p) !== input.preview_hash)
    fail(409, "Os valores mudaram. Atualize a prévia.");
  const due = input.due_on ? cal.date(input.due_on) : pp.current.due_on;
  if (due < input.end) fail(400, "Vencimento anterior ao fim do período.");
  const id = randomUUID(),
    snapshot = {
      ...p,
      preview_hash: input.preview_hash,
      policy: pp.policy,
      reason,
      due_on: due,
    };
  const row = (
    await db.query(
      "INSERT INTO zc_settlements(id,technician_id,start_date,end_date,total_cents,snapshot,created_at,created_by,state,due_on,request_key) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'draft',$9,$10) RETURNING *",
      [
        id,
        p.technician.id,
        p.start,
        p.end,
        p.total_cents,
        JSON.stringify(snapshot),
        d.now(),
        actor,
        due,
        key,
      ],
    )
  ).rows[0];
  for (const item of p.orders)
    await db.query(
      "INSERT INTO zc_settlement_orders(order_id,settlement_id) VALUES($1,$2)",
      [item.id, id],
    );
  const ids = [
    ...p.carry_adjustments,
    ...p.orders.flatMap((x) => x.adjustments),
  ].map((x) => x.id);
  if (ids.length)
    await db.query(
      "UPDATE zc_adjustments SET settlement_id=$1 WHERE id=ANY($2::text[])",
      [id, ids],
    );
  await d.audit(db, actor, "closing_created", "settlement", id, {
    total_cents: p.total_cents,
  });
  await notify(
    db,
    "technician",
    p.technician.id,
    "closing:" + id,
    "Fechamento disponível para conferência",
    { settlement_id: id, total_cents: p.total_cents },
    "finance",
  );
  return row;
}
async function approveClosing(db, id, actor) {
  const s = await d.one(
    db,
    "SELECT * FROM zc_settlements WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!s) fail(404, "Fechamento não encontrado.");
  if (!["draft", "legacy_unverified"].includes(s.state)) return s;
  const state = s.total_cents === 0 ? "no_payment_due" : "awaiting_payment";
  await db.query(
    "UPDATE zc_settlements SET state=$4,approved_by=$2,approved_at=$3 WHERE id=$1",
    [id, actor, d.now(), state],
  );
  await d.audit(db, actor, "closing_approved", "settlement", id);
  await notify(
    db,
    "technician",
    s.technician_id,
    "closing-approved:" + id,
    state === "no_payment_due"
      ? "Fechamento aprovado sem valor a pagar."
      : "Fechamento aprovado. Aguardando pagamento.",
    { settlement_id: id },
    "finance",
  );
  return { ...s, state };
}
async function payment(db, id, input, actor, receipt = {}) {
  const amount = input.amount_cents;
  cal.date(input.paid_on);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1e9)
    fail(400, "Valor do pagamento inválido.");
  if (input.paid_on > d.today())
    fail(400, "Pagamento não pode ter data futura.");
  const reference = d.string(input.reference, "Referência externa", 250, true),
    key = d.string(input.request_key, "Chave", 160, true);
  if (key.length < 12) fail(400, "Chave de confirmação muito curta.");
  const fingerprint = digest({
    id,
    amount,
    day: input.paid_on,
    reference,
    receipt_sha: receipt.sha || "",
  });
  const previous = await d.one(
    db,
    "SELECT * FROM zc_payments WHERE request_key=$1",
    [key],
  );
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      fail(409, "Esta chave pertence a outro pagamento.");
    return previous;
  }
  const s = await d.one(
    db,
    "SELECT * FROM zc_settlements WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!s) fail(404, "Fechamento não encontrado.");
  if (!["approved", "awaiting_payment", "partial"].includes(s.state))
    fail(409, "Aprove o fechamento antes de registrar pagamento.");
  const paid = Number(
    (
      await d.one(
        db,
        "SELECT COALESCE(sum(amount_cents),0) n FROM zc_payments WHERE settlement_id=$1",
        [id],
      )
    ).n,
  );
  if (paid + amount > s.total_cents)
    fail(409, "Valor superior ao saldo do fechamento.");
  const pid = randomUUID();
  const row = (
    await db.query(
      "INSERT INTO zc_payments(id,settlement_id,amount_cents,paid_on,reference,receipt_path,receipt_mime,created_by,request_key,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [
        pid,
        id,
        amount,
        input.paid_on,
        reference,
        receipt.path || "",
        receipt.mime || "",
        actor,
        key,
        fingerprint,
      ],
    )
  ).rows[0];
  const state = paid + amount === s.total_cents ? "paid" : "partial";
  await db.query("UPDATE zc_settlements SET state=$2 WHERE id=$1", [id, state]);
  await d.audit(db, actor, "external_payment_recorded", "settlement", id, {
    payment_id: pid,
    amount_cents: amount,
    reference,
  });
  await notify(
    db,
    "technician",
    s.technician_id,
    "payment:" + pid,
    "Pagamento externo registrado",
    { settlement_id: id, amount_cents: amount, state },
    "finance",
  );
  return row;
}
async function summary(db, tid) {
  const cycle = await policyFor(db, tid);
  const ledger = await d.rows(
    db,
    "SELECT l.*,o.vehicle,o.service,o.status,s.settlement_id,COALESCE((SELECT sum(a.amount_cents)::int FROM zc_adjustments a WHERE a.order_id=l.order_id),0) adjustment_cents FROM zc_financial_ledger l JOIN zc_orders o ON o.id=l.order_id LEFT JOIN zc_settlement_orders s ON s.order_id=l.order_id WHERE o.tracker_waiver_authorized=false AND l.technician_id=$1 ORDER BY l.executed_on DESC,l.order_id LIMIT 1000",
    [tid],
  );
  const settlements = await d.rows(
    db,
    "SELECT s.*,COALESCE((SELECT sum(p.amount_cents)::int FROM zc_payments p WHERE p.settlement_id=s.id),0) paid_cents FROM zc_settlements s WHERE s.technician_id=$1 ORDER BY created_at DESC LIMIT 200",
    [tid],
  );
  for (const s of settlements) {
    s.balance_cents =
      s.state === "legacy_unverified" ? null : s.total_cents - s.paid_cents;
    s.payments = await d.rows(
      db,
      "SELECT id,amount_cents,paid_on,reference,receipt_mime,created_at FROM zc_payments WHERE settlement_id=$1 ORDER BY created_at",
      [s.id],
    );
  }
  const adjustments = await d.rows(
    db,
    "SELECT a.* FROM zc_adjustments a JOIN zc_financial_ledger l ON l.order_id=a.order_id JOIN zc_orders o ON o.id=l.order_id WHERE o.tracker_waiver_authorized=false AND l.technician_id=$1 ORDER BY a.created_at DESC LIMIT 200",
    [tid],
  );
  // Totals cover the entire account, independently of display limits above.
  const base = await d.one(
    db,
    "SELECT COALESCE(sum(l.total_cents) FILTER(WHERE l.state='awaiting_approval'),0) estimated,COALESCE(sum(l.total_cents) FILTER(WHERE l.state='approved' AND o.status='CONCLUÍDO'),0) confirmed FROM zc_financial_ledger l JOIN zc_orders o ON o.id=l.order_id WHERE o.tracker_waiver_authorized=false AND l.technician_id=$1 AND o.deleted_at='' AND o.status<>'CANCELADO' AND NOT EXISTS(SELECT 1 FROM zc_settlement_orders s WHERE s.order_id=l.order_id)",
    [tid],
  );
  const extra = await d.one(
    db,
    "SELECT COALESCE(sum(a.amount_cents) FILTER(WHERE l.state='awaiting_approval'),0) estimated,COALESCE(sum(a.amount_cents) FILTER(WHERE l.state='approved' AND o.status='CONCLUÍDO'),0) confirmed FROM zc_adjustments a JOIN zc_financial_ledger l ON l.order_id=a.order_id JOIN zc_orders o ON o.id=l.order_id WHERE o.tracker_waiver_authorized=false AND l.technician_id=$1 AND a.settlement_id IS NULL AND o.deleted_at='' AND o.status<>'CANCELADO'",
    [tid],
  );
  const balances = await d.one(
    db,
    "SELECT COALESCE(sum(s.total_cents-COALESCE((SELECT sum(p.amount_cents) FROM zc_payments p WHERE p.settlement_id=s.id),0)) FILTER(WHERE s.state NOT IN ('draft','legacy_unverified')),0) balance,COALESCE(sum(s.total_cents) FILTER(WHERE s.state='draft'),0) pending,COALESCE(sum(s.total_cents) FILTER(WHERE s.state='legacy_unverified'),0) unverified FROM zc_settlements s WHERE s.technician_id=$1",
    [tid],
  );
  return {
    cycle,
    ledger,
    settlements,
    adjustments,
    estimated_cents: Number(base.estimated) + Number(extra.estimated),
    confirmed_cents: Number(base.confirmed) + Number(extra.confirmed),
    balance_cents: Number(balances.balance),
    pending_closing_cents: Number(balances.pending),
    unverified_cents: Number(balances.unverified),
  };
}
module.exports = {
  prices,
  initialRate,
  addRate,
  capture,
  makeEligible,
  policyFor,
  preview,
  digest,
  createClosing,
  approveClosing,
  payment,
  summary,
};
