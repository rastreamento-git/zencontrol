const { randomUUID } = require("node:crypto");
const d = require("./domain"),
  o = require("./orders");
const { bundled, isInstallation, reused } = require("./equipment-plan");
const { fail } = require("./errors");
async function participants(db, order) {
  if (order.parent_order_id || !bundled(order)) return [order];
  const children = await d.rows(
    db,
    "SELECT * FROM zc_orders WHERE parent_order_id=$1 AND deleted_at='' ORDER BY id",
    [order.id],
  );
  if (children.some((child) => child.technician_id !== order.technician_id))
    fail(
      409,
      "Os equipamentos do atendimento precisam estar atribuídos ao mesmo técnico.",
    );
  return [order, ...children];
}
async function captureGroup(db, order, day) {
  if (
    order.status === "REAGENDAR" ||
    order.document_data?.visit_outcome === "reschedule"
  )
    fail(
      409,
      "Confirme uma nova data com a central antes de registrar a execução.",
    );
  for (const item of await participants(db, order)) {
    await require("./finance-engine").capture(db, item, day);
    if (item.id !== order.id)
      await o.update(
        db,
        "zc_orders",
        "id",
        item.id,
        {
          executed_on: day,
          execution_finished_at: d.now(),
          updated_at: d.now(),
        },
        true,
      );
  }
}
async function recordApproval(db, cfg, order, b, codes, reason, actor) {
  const people = await participants(db, order);
  const files = await d.rows(
    db,
    "SELECT serial_code,equipment_type FROM zc_evidence WHERE batch_id=$1 AND kind='label' ORDER BY serial_code",
    [b.id],
  );
  const unused = new Set(codes);
  for (const item of people.slice(1)) {
    const code = files.find(
      (file) =>
        file.equipment_type === item.additional_equipment &&
        unused.has(file.serial_code),
    )?.serial_code;
    if (!code)
      fail(
        409,
        "A quantidade de equipamentos adicionais diverge das fotos enviadas.",
      );
    unused.delete(code);
    const prior = await d.one(
      db,
      "SELECT 1 FROM zc_batches WHERE order_id=$1 AND state IN ('submitted','approved_sync','stock_failed')",
      [item.id],
    );
    if (prior)
      fail(409, "Um equipamento adicional já tem conferência em andamento.");
    const child = await o.update(
      db,
      "zc_orders",
      "id",
      item.id,
      {
        status: "AGUARDANDO ESTOQUE",
        imei: code,
        stock_sync_state: "pending",
        updated_at: d.now(),
      },
      true,
    );
    const cb = await o.insert(db, "zc_batches", {
      id: randomUUID(),
      order_id: item.id,
      technician_id: child.technician_id,
      source: "bundle",
      source_user_id: b.source_user_id,
      sender: "bundle",
      vehicle: child.vehicle,
      state: "approved_sync",
      notes: b.notes,
      imeis: JSON.stringify([code]),
      created_at: d.now(),
      submitted_at: b.submitted_at,
      reviewed_by: actor,
      reviewed_at: d.now(),
      reason,
      capture_version: 2,
      checklist_signed: true,
      executed_on: order.executed_on,
      order_version: child.version,
      order_snapshot: JSON.stringify({
        parent_order_id: order.id,
        parent_submission_id: b.id,
      }),
      approval_payload: JSON.stringify({
        parent_order_id: order.id,
        parent_submission_id: b.id,
      }),
    });
    await d.audit(db, actor, "additional_service_approved", "order", item.id, {
      parent_order_id: order.id,
      parent_submission_id: b.id,
      submission_id: cb.id,
      serials: [code],
    });
  }
  if (people.length > 1 && unused.size !== 1)
    fail(409, "Cada equipamento deve contabilizar exatamente um serviço.");
}
async function completeChildren(db, cfg, order, b, receipt, jobId) {
  if (!bundled(order) || order.parent_order_id) return;
  const batches = await d.rows(
    db,
    "SELECT * FROM zc_batches WHERE source='bundle' AND order_snapshot->>'parent_submission_id'=$1 AND state='approved_sync' ORDER BY order_id",
    [b.id],
  );
  for (const childBatch of batches) {
    const child = await o.get(db, childBatch.order_id);
    if (!childBatch.imeis.every((code) => receipt.serials.includes(code)))
      fail(409, "O recibo não confirma os equipamentos adicionais.");
    await o.update(
      db,
      "zc_orders",
      "id",
      child.id,
      {
        stock_receipt: JSON.stringify({
          ...receipt,
          parent_order_id: order.id,
          allocated_serials: childBatch.imeis,
        }),
        stock_sync_state: "confirmed",
        updated_at: d.now(),
      },
      true,
    );
    await o.update(
      db,
      "zc_batches",
      "id",
      childBatch.id,
      { state: "completed" },
      true,
    );
    await o.complete(
      db,
      child.id,
      b.reviewed_by,
      b.reason,
      cfg,
      childBatch.id,
      { confirmedSubmission: childBatch.id, stockReceipt: receipt, jobId },
    );
  }
}
async function rejectChildren(db, order, b, reason) {
  if (!bundled(order) || order.parent_order_id) return;
  await db.query(
    "UPDATE zc_batches SET state='withdrawn',rejection_reason=$2,version=version+1 WHERE source='bundle' AND order_snapshot->>'parent_submission_id'=$1 AND state='approved_sync'",
    [b.id, reason],
  );
  await db.query(
    "UPDATE zc_orders SET status='CORREÇÃO SOLICITADA',stock_sync_state='',updated_at=$2,version=version+1 WHERE parent_order_id=$1 AND deleted_at='' AND status<>'CONCLUÍDO'",
    [order.id, d.now()],
  );
}
module.exports = {
  participants,
  captureGroup,
  recordApproval,
  completeChildren,
  rejectChildren,
};
