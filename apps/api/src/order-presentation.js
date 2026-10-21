const d = require("./domain");

// An additional OS keeps its own stock and financial records, but belongs to
// the same attendance in operational lists. A technician only groups records
// within their own scope; a reassigned child never exposes another technician.
async function groupedPage(
  db,
  { base, conditions, args, page, limit, sort, view },
) {
  const cte = `WITH eligible AS (SELECT * FROM zc_orders WHERE ${base}),
    matches AS (SELECT DISTINCT CASE WHEN parent_order_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM eligible parent WHERE parent.id=eligible.parent_order_id)
      THEN parent_order_id ELSE id END group_id FROM eligible WHERE ${conditions || "true"}),
    visible AS (SELECT group_id FROM matches ${
      ["open", "closed"].includes(view)
        ? `WHERE ${view === "closed" ? "NOT " : ""}EXISTS(
      SELECT 1 FROM eligible member WHERE (member.id=matches.group_id OR member.parent_order_id=matches.group_id)
      AND member.status NOT IN ('CONCLUÍDO','CANCELADO'))`
        : ""
    })`;
  const total = Number(
    (await d.one(db, cte + " SELECT count(*) n FROM visible", args)).n,
  );
  const items = await d.rows(
    db,
    cte +
      ` SELECT * FROM eligible WHERE id IN (SELECT group_id FROM visible)
    ORDER BY ${sort} LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, limit, (page - 1) * limit],
  );
  return { items, total, page, limit };
}

async function presentOrders(db, orders, { technicianId = null } = {}) {
  if (!orders.length) return [];
  const children = await d.rows(
    db,
    "SELECT * FROM zc_orders WHERE parent_order_id=ANY($1::text[]) AND deleted_at=''" +
      (technicianId === null
        ? ""
        : " AND technician_id=$2 AND workflow_mode='controlled'") +
      " ORDER BY id",
    technicianId === null
      ? [orders.map((o) => o.id)]
      : [orders.map((o) => o.id), technicianId],
  );
  const all = [...orders, ...children];
  const batches = await d.rows(
    db,
    "SELECT id,order_id,state,imeis,notes,submitted_at,created_at FROM zc_batches WHERE order_id=ANY($1::text[]) AND source='portal' AND (submitted_at<>'' OR state='draft') ORDER BY created_at DESC,id DESC",
    [all.map((o) => o.id)],
  );
  const present = (order) => {
    const submitted = batches.find(
      (b) => b.order_id === order.id && b.submitted_at,
    );
    const execution =
      submitted ||
      (order.execution_finished_at &&
        batches.find((b) => b.order_id === order.id && b.state === "draft"));
    const codes = submitted?.imeis || [];
    return {
      ...d.publicOrder(order),
      vehicle_electric: order.document_data?.vehicle_electric === true,
      imei:
        order.workflow_mode === "controlled" ? codes.join(", ") : order.imei,
      reported_imeis: codes,
      imei_submission_state: submitted?.state || "",
      imei_submitted_at: submitted?.submitted_at || "",
      technician_notes: execution?.notes || "",
    };
  };
  return orders.map((order) => {
    const main = present(order);
    main.additional_orders = children
      .filter((o) => o.parent_order_id === order.id)
      .map(present);
    main.group_imeis = [
      ...new Set(
        [main, ...main.additional_orders].flatMap((o) => o.reported_imeis),
      ),
    ];
    main.group_status =
      [main, ...main.additional_orders].find(
        (o) => !["CONCLUÍDO", "CANCELADO"].includes(o.status),
      )?.status || main.status;
    return main;
  });
}

async function orderHistory(db, order) {
  const ids = [order.id, ...(order.additional_orders || []).map((o) => o.id)];
  const history = await d.rows(
    db,
    `SELECT a.*,
    COALESCE(NULLIF(u.nome,''),u.login,a.actor) actor,
    CASE WHEN a.entity_type='order' THEN a.entity_id ELSE b.order_id END order_id
    FROM zc_audit a LEFT JOIN zc_batches b ON a.entity_type='batch' AND b.id=a.entity_id
    LEFT JOIN usuarios u ON u.id=CASE WHEN a.actor ~ '^[0-9]{1,9}$' THEN a.actor::integer ELSE NULL END
    WHERE (a.entity_type='order' AND a.entity_id=ANY($1::text[])) OR b.order_id=ANY($1::text[])
    ORDER BY a.id DESC LIMIT 100`,
    [ids],
  );
  const own = history.filter((a) => a.order_id === order.id);
  return {
    history,
    audit_summary: {
      opened_by:
        own.find((a) => a.action === "created")?.actor ||
        order.created_by ||
        "Não identificado (legado)",
      opened_at:
        own.find((a) => a.action === "created")?.created_at ||
        order.created_date,
      closed_by: order.closed_by || "",
      closed_at:
        own.find((a) => a.action === "completed")?.created_at ||
        order.completed_at ||
        "",
      last_modified_by:
        history[0]?.actor || order.created_by || "Não identificado (legado)",
      last_modified_at: history[0]?.created_at || order.updated_at,
    },
  };
}

module.exports = { groupedPage, presentOrders, orderHistory };
