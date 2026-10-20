const { randomUUID } = require("node:crypto");
const { transaction } = require("./database");
const { fail } = require("./errors");
const d = require("./domain");
const { normalizeDocumentData } = require("./order-document");
const { prepareEquipment } = require("./equipment-plan");
const textFields = {
  customer_name: 200,
  contact: 100,
  chassis: 40,
  fipe_value: 40,
  fipe_risk: 100,
  volunteer: 200,
  imei: 500,
  term: 300,
  location: 500,
  shift: 40,
  notes: 6000,
  sga_id: 50,
  vehicle: 40,
  service: 120,
  scheduled_at: 30,
  sga_classification: 200,
  sga_status: 200,
};
async function get(db, id) {
  const o = await d.one(
    db,
    "SELECT * FROM zc_orders WHERE id=$1 AND deleted_at=''",
    [id],
  );
  if (!o) fail(404, "Ordem de serviço não encontrada.");
  return o;
}
async function insert(db, table, data) {
  const cols = Object.keys(data);
  return d.one(
    db,
    `INSERT INTO ${table}(${cols.join(",")}) VALUES(${cols.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
    Object.values(data),
  );
}
async function update(db, table, key, value, data, version = false) {
  const cols = Object.keys(data);
  return d.one(
    db,
    `UPDATE ${table} SET ${cols.map((k, i) => k + "=$" + (i + 1)).join(",")}${version ? ",version=version+1" : ""} WHERE ${key}=$${cols.length + 1} RETURNING *`,
    [...Object.values(data), value],
  );
}
async function guard(db, id, options = {}) {
  if (
    await d.one(
      db,
      "SELECT 1 FROM zc_batches WHERE order_id=$1 AND source='portal' AND state IN ('submitted','approved_sync','stock_failed') AND id<>$2",
      [id, options.allowBatch || ""],
    )
  )
    fail(
      409,
      "Existe um retorno em conferência ou aguardando estoque. Conclua sua revisão antes de alterar.",
    );
  if (
    await d.one(
      db,
      "SELECT 1 FROM zc_jobs WHERE order_id=$1 AND kind='stock_installation' AND state IN ('pending','running','uncertain') AND id<>$2",
      [id, options.allowJob || ""],
    )
  )
    fail(409, "A confirmação de estoque está pendente.");
  if (
    await d.one(
      db,
      "SELECT id FROM zc_jobs WHERE order_id=$1 AND state='running' AND kind IN ('dispatch','sga_classification','upload_evidence')",
      [id],
    )
  )
    fail(
      409,
      "Uma integração está em execução. Aguarde a confirmação antes de alterar.",
    );
}
async function validate(db, input, old = null) {
  const out = {};
  for (const [key, max] of Object.entries(textFields))
    if (input[key] !== undefined) out[key] = d.string(input[key], key, max);
  if (out.vehicle !== undefined) {
    out.vehicle = d.vehicle(out.vehicle);
    if (out.vehicle.length < 7 || out.vehicle.length > 30)
      fail(400, "Informe uma placa ou chassi válido.");
  }
  if (
    out.service !== undefined &&
    !d.services.some((s) => out.service.startsWith(s))
  )
    fail(400, "Serviço inválido.");
  if (out.sga_id && !/^\d+$/.test(out.sga_id))
    fail(400, "Código SGA inválido.");
  if (out.scheduled_at) {
    const parsed = d.date(out.scheduled_at, true);
    if (!parsed) fail(400, "Data e horário inválidos.");
    out.scheduled_at = parsed;
  }
  if (input.technician_id !== undefined) {
    if (input.technician_id === null || input.technician_id === "") {
      out.technician_id = null;
      out.technician_name = "";
    } else {
      const t = await d.one(
        db,
        "SELECT * FROM zc_technicians WHERE id=$1 AND (active=true OR id=$2)",
        [input.technician_id, old?.technician_id || null],
      );
      if (!t) fail(400, "Selecione um técnico ativo.");
      out.technician_id = t.id;
      out.technician_name = t.name;
    }
  }
  if (input.status !== undefined) {
    if (!d.statuses.includes(input.status)) fail(400, "Situação inválida.");
    if (input.status === "CONCLUÍDO" && old?.status !== "CONCLUÍDO")
      fail(400, "Use a ação Concluir para registrar a baixa.");
    if (
      (!old || old.workflow_mode === "controlled") &&
      [
        "AGUARDANDO ESTOQUE",
        "AGUARDANDO VALIDAÇÃO",
        "EXECUÇÃO FINALIZADA",
        "AGUARDANDO CONFERÊNCIA",
        "CORREÇÃO SOLICITADA",
      ].includes(input.status) &&
      old?.status !== input.status
    )
      fail(400, "Esta situação é definida pelo fluxo de envio e conferência.");
    out.status = input.status;
  }
  if (input.tracker_waiver_authorized !== undefined)
    out.tracker_waiver_authorized = d.boolean(
      input.tracker_waiver_authorized,
      "Dispensa de rastreador autorizada",
    );
  if (input.document_data !== undefined)
    out.document_data = JSON.stringify(
      normalizeDocumentData(input.document_data, old?.document_data || {}),
    );
  const merged = { ...old, ...out };
  if (!old) {
    for (const key of ["vehicle", "service", "customer_name"])
      if (!merged[key]) fail(400, "Informe veículo, associado e serviço.");
    out.status ||=
      out.technician_id && out.scheduled_at ? "AGENDADO" : "PENDENTE";
  }
  if (
    ["AGENDADO", "EM EXECUÇÃO"].includes(merged.status) &&
    (!merged.technician_id || !merged.scheduled_at)
  )
    fail(400, "Defina técnico e agendamento.");
  return out;
}
const additionalSummary = (row) => ({
  id: row.id,
  parent_order_id: row.parent_order_id,
  additional_equipment: row.additional_equipment,
  service: row.service,
  status: row.status,
});
async function ensureAdditionalOrders(db, parent, types, actor) {
  const result = [];
  for (const type of types) {
    const existing = await d.one(
      db,
      "SELECT * FROM zc_orders WHERE parent_order_id=$1 AND additional_equipment=$2",
      [parent.id, type],
    );
    if (existing) {
      if (existing.deleted_at)
        fail(
          409,
          "Já existe uma OS adicional removida para este equipamento. Revise o histórico com a central.",
        );
      result.push(additionalSummary(existing));
      continue;
    }
    const data = Object.fromEntries(
      Object.keys(textFields)
        .filter((k) => parent[k] !== undefined)
        .map((k) => [k, parent[k]]),
    );
    const firstId = parent.id + "_EXTRA";
    const id = (await d.one(db, "SELECT 1 FROM zc_orders WHERE id=$1", [
      firstId,
    ]))
      ? firstId + "_" + type
      : firstId;
    const baseService = d.services.find((s) => parent.service.startsWith(s));
    const extra = await insert(db, "zc_orders", {
      ...data,
      id,
      workflow_mode: "controlled",
      parent_order_id: parent.id,
      additional_equipment: type,
      service: baseService + " (Equipamento adicional)",
      technician_id: parent.technician_id,
      technician_name: parent.technician_name,
      status:
        parent.technician_id && parent.scheduled_at ? "AGENDADO" : "PENDENTE",
      imei: "",
      notes: (
        "Equipamento adicional: " +
        type +
        ". OS principal: " +
        parent.id +
        ".\n" +
        (parent.notes || "")
      ).slice(0, 6000),
      document_data: JSON.stringify({
        ...parent.document_data,
        equipment: [type === "TAG" ? "tag" : "tracker"],
      }),
      created_date: d.today(),
      created_by: actor,
      updated_at: d.now(),
    });
    await require("./notifications").orderEvent(db, extra, "created");
    await d.audit(db, actor, "created", "order", extra.id, {
      parent_id: parent.id,
      additional_equipment: type,
    });
    await d.audit(db, actor, "additional_order_created", "order", parent.id, {
      additional_order_id: extra.id,
      additional_equipment: type,
    });
    result.push(additionalSummary(extra));
  }
  return result;
}
async function create(pool, input, actor) {
  return transaction(pool, async (db) => {
    const data = await validate(db, input);
    const additional = prepareEquipment(data, input);
    const o = await insert(db, "zc_orders", {
      ...data,
      workflow_mode: "controlled",
      id: "OS-" + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
      created_date: d.today(),
      created_by: actor,
      updated_at: d.now(),
    });
    await require("./notifications").orderEvent(db, o, "created");
    await d.audit(db, actor, "created", "order", o.id);
    const additionalOrders = await ensureAdditionalOrders(
      db,
      o,
      additional,
      actor,
    );
    return { ...o, additional_orders: additionalOrders };
  });
}
async function edit(pool, id, input, actor) {
  return transaction(pool, async (db) => {
    const old = await get(db, id);
    await guard(db, id);
    if (old.workflow_mode === "controlled" && old.status === "CONCLUÍDO")
      fail(
        409,
        "A OS confirmada preserva os dados da conferência e do estoque. Registre ajustes em um novo atendimento.",
      );
    if (input.version !== old.version)
      fail(409, "A OS mudou. Atualize antes de salvar.");
    if (
      await d.one(db, "SELECT 1 FROM zc_settlement_orders WHERE order_id=$1", [
        id,
      ])
    )
      fail(409, "OS incluída em fechamento financeiro.");
    if (
      old.status === "CONCLUÍDO" &&
      input.status &&
      input.status !== old.status
    )
      fail(409, "Uma OS concluída exige reabertura pela administração.");
    const data = await validate(db, input, old);
    const additional = prepareEquipment(data, input, old);
    if (
      ((data.technician_id !== undefined &&
        data.technician_id !== old.technician_id) ||
        (data.service !== undefined && data.service !== old.service)) &&
      (await d.one(db, "SELECT 1 FROM zc_financial_ledger WHERE order_id=$1", [
        id,
      ]))
    )
      fail(
        409,
        "Esta execução já tem composição financeira. Preserve o histórico e crie outra OS para alterar técnico ou serviço.",
      );
    const changes = Object.fromEntries(
      Object.entries(data).filter(([k, v]) =>
        k === "document_data" ? JSON.stringify(old[k]) !== v : old[k] !== v,
      ),
    );
    if (!Object.keys(changes).length)
      return {
        ...old,
        additional_orders: await ensureAdditionalOrders(
          db,
          old,
          additional,
          actor,
        ),
      };
    const result = await update(
      db,
      "zc_orders",
      "id",
      id,
      { ...data, updated_at: d.now() },
      true,
    );
    if (result.status === "CANCELADO")
      await db.query(
        "UPDATE zc_financial_ledger SET state='cancelled' WHERE order_id=$1",
        [id],
      );
    await require("./notifications").orderEvent(
      db,
      result,
      result.status === "CANCELADO" ? "cancelled" : "updated",
    );
    if (old.technician_id && old.technician_id !== result.technician_id)
      await require("./notifications").orderEvent(
        db,
        { ...old, version: result.version },
        "updated",
        { removed: true },
      );
    await d.audit(db, actor, "updated", "order", id, {
      ...changes,
      ...(changes.document_data
        ? {
            document_data: {
              updated_fields: Object.keys(JSON.parse(changes.document_data)),
            },
          }
        : {}),
    });
    return {
      ...result,
      additional_orders: await ensureAdditionalOrders(
        db,
        result,
        additional,
        actor,
      ),
    };
  });
}
async function enqueue(db, kind, orderId, payload, key) {
  await db.query(
    "INSERT INTO zc_jobs(id,kind,order_id,payload,created_at,idempotency_key) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(idempotency_key) DO NOTHING",
    [randomUUID(), kind, orderId, JSON.stringify(payload), d.now(), key],
  );
  return (
    await d.one(db, "SELECT id FROM zc_jobs WHERE idempotency_key=$1", [key])
  ).id;
}
async function complete(
  db,
  id,
  actor,
  reason,
  cfg,
  batchId = null,
  options = {},
) {
  const o = await get(db, id);
  if (o.workflow_mode === "controlled") {
    const approved =
      options.confirmedSubmission &&
      (await d.one(
        db,
        "SELECT * FROM zc_batches WHERE id=$1 AND order_id=$2 AND state='completed' AND reviewed_by<>''",
        [options.confirmedSubmission, id],
      ));
    if (!approved)
      fail(409, "A baixa exige envio técnico e confirmação na central.");
    const key = d.services.find((s) => o.service.startsWith(s));
    const r = await d.one(
      db,
      "SELECT stock_action FROM zc_service_rules WHERE service=$1",
      [key],
    );
    if (
      !o.tracker_waiver_authorized &&
      r?.stock_action === "install" &&
      (!options.stockReceipt ||
        o.stock_sync_state !== "confirmed" ||
        !o.stock_receipt)
    )
      fail(409, "A instalação ainda não foi confirmada no Estoque Pro.");
  }
  await guard(db, id, {
    allowBatch: options.confirmedSubmission,
    allowJob: options.jobId,
  });
  if (o.status === "CONCLUÍDO") return o;
  if (o.status === "CANCELADO")
    fail(409, "OS cancelada não pode receber baixa.");
  if (!o.technician_id) fail(400, "Vincule um técnico antes da baixa.");
  reason = d.string(reason, "Motivo", 1000, true);
  if (reason.length < 5) fail(400, "Descreva o motivo da conclusão.");
  const updated = await update(
    db,
    "zc_orders",
    "id",
    id,
    {
      status: "CONCLUÍDO",
      completed_at: d.today(),
      closed_by: actor,
      updated_at: d.now(),
    },
    true,
  );
  await require("./finance-engine").makeEligible(db, updated);
  await require("./notifications").orderEvent(db, updated, "completed");
  await d.audit(db, actor, "completed", "order", id, {
    reason,
    batch_id: batchId,
  });
  if (cfg.SGA_SYNC_ENABLED && o.sga_id && !o.tracker_waiver_authorized)
    await enqueue(
      db,
      "sga_classification",
      id,
      { code: cfg.SGA_COMPLETED_CODE, target_status: "CONCLUÍDO" },
      "complete:" + id + ":" + updated.version,
    );
  return updated;
}
async function dispatch(pool, id, input, actor, cfg) {
  const current = await get(pool, id);
  if (current.workflow_mode === "controlled") {
    if (!current.technician_id) fail(400, "Atribua um técnico ao serviço.");
    return transaction(pool, async (db) => {
      await require("./notifications").orderEvent(db, current, "created");
      await d.audit(db, actor, "assigned_internally", "order", id);
      return null;
    });
  }
  if (!cfg.INTEGRATIONS_ENABLED)
    fail(409, "Integrações desativadas no servidor.");
  return transaction(pool, async (db) => {
    const o = await get(db, id);
    if (input.version !== o.version)
      fail(409, "A OS mudou. Atualize antes de enviar.");
    if (!o.technician_id || !o.scheduled_at)
      fail(400, "Defina técnico e agendamento.");
    if (["CONCLUÍDO", "CANCELADO"].includes(o.status))
      fail(409, "OS encerrada.");
    if (
      await d.one(
        db,
        "SELECT id FROM zc_jobs WHERE order_id=$1 AND kind='dispatch' AND state IN ('pending','running','uncertain')",
        [id],
      )
    )
      fail(409, "Já existe envio pendente ou sem confirmação.");
    const t = await d.one(
      db,
      "SELECT * FROM zc_technicians WHERE id=$1 AND active=true",
      [o.technician_id],
    );
    if (!t || !(t.send_group || t.phone))
      fail(400, "Configure o destino do técnico.");
    const job = await enqueue(
      db,
      "dispatch",
      id,
      { version: o.version, masked: input.masked !== false },
      "dispatch:" + id + ":" + o.version,
    );
    await d.audit(db, actor, "dispatch_queued", "order", id, { job_id: job });
    return job;
  });
}
async function financial(db, tid, start, end) {
  if (!d.date(start) || !d.date(end) || start > end)
    fail(400, "Período inválido.");
  const t = await d.one(db, "SELECT * FROM zc_technicians WHERE id=$1", [tid]);
  if (!t) fail(404, "Técnico não encontrado.");
  const list = await d.rows(
    db,
    "SELECT * FROM zc_orders o WHERE tracker_waiver_authorized=false AND technician_id=$1 AND status='CONCLUÍDO' AND deleted_at='' AND substring(completed_at,1,10) BETWEEN $2 AND $3 AND NOT EXISTS(SELECT 1 FROM zc_settlement_orders s WHERE s.order_id=o.id) ORDER BY completed_at,id",
    [tid, start, end],
  );
  const orders = [];
  for (const o of list) {
    const s = d.normalized(o.service);
    const key = s.includes("MANUT")
      ? "price_maintenance"
      : s.includes("RETIR")
        ? "price_removal"
        : s.includes("IMPROD") || s.includes("VISITA")
          ? "price_visit"
          : "price_install";
    const extras = await d.rows(
      db,
      "SELECT * FROM zc_order_extras WHERE order_id=$1",
      [o.id],
    );
    const ledger = await d.one(
      db,
      "SELECT * FROM zc_financial_ledger WHERE order_id=$1",
      [o.id],
    );
    orders.push({
      id: o.id,
      vehicle: o.vehicle,
      service: o.service,
      completed_at: o.completed_at,
      base_cents: ledger?.base_cents ?? t[key],
      extras: ledger?.extras ?? extras,
      total_cents:
        ledger?.total_cents ??
        t[key] + extras.reduce((a, x) => a + x.amount_cents, 0),
    });
  }
  return {
    technician: { id: t.id, name: t.name },
    start,
    end,
    orders,
    total_cents: orders.reduce((n, o) => n + o.total_cents, 0),
  };
}
module.exports = {
  get,
  insert,
  update,
  guard,
  create,
  edit,
  enqueue,
  complete,
  dispatch,
  financial,
};
