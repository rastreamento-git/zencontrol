const { randomUUID } = require("node:crypto");
async function notify(
  db,
  audience,
  technicianId,
  key,
  title,
  detail = {},
  target = "",
) {
  await db.query(
    "INSERT INTO zc_notifications(id,audience,technician_id,event_key,title,detail,target) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT DO NOTHING",
    [
      randomUUID(),
      audience,
      technicianId,
      key,
      title,
      JSON.stringify(detail),
      target,
    ],
  );
}
async function orderEvent(db, order, action, detail = {}) {
  if (order.workflow_mode !== "controlled") return;
  if (order.parent_order_id && order.document_data?.equipment_counts) return;
  const key = `${action}:${order.id}:${order.version}`;
  const info = {
    order_id: order.id,
    technician: order.technician_name,
    service: order.service,
    scheduled_at: order.scheduled_at,
    ...detail,
  };
  const title = {
    created: "Nova ordem de serviço",
    updated: "Ordem de serviço atualizada",
    submitted: "Execução enviada para conferência",
    correction: "Correção solicitada",
    approved: "Serviço aprovado pela central",
    completed: "Serviço concluído",
    cancelled: "Serviço cancelado",
  }[action];
  if (order.technician_id && title)
    await notify(
      db,
      "technician",
      order.technician_id,
      key,
      title,
      info,
      order.id,
    );
  if (action === "submitted")
    await notify(
      db,
      "central",
      null,
      key,
      "Novo serviço aguardando conferência.",
      info,
      order.id,
    );
}
module.exports = { notify, orderEvent };
