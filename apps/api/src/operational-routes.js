const { randomUUID } = require("node:crypto");
const { transaction } = require("./database");
const { fail, integer } = require("./errors");
const d = require("./domain"),
  o = require("./orders");
const statuses = ["registered", "in_progress", "completed", "cancelled"];

function status(value) {
  if (!statuses.includes(value)) fail(400, "Situação operacional inválida.");
  return value;
}
function configureOperational(app, pool, auth) {
  const staff = auth.requireAdmin;
  const actor = (req) => req.user.nome || req.user.login;
  const get = async (db, id, lock = false) => {
    const row = await d.one(
      db,
      "SELECT * FROM zc_operational_services WHERE id=$1" +
        (lock ? " FOR UPDATE" : ""),
      [id],
    );
    if (!row) fail(404, "Serviço operacional não encontrado.");
    return row;
  };
  app.get("/api/operational-services", staff, async (req, res) => {
    const term = d.string(req.query.q || "", "Pesquisa", 200),
      filter = req.query.status ? status(req.query.status) : "",
      page = integer(req.query.page || 1, "Página"),
      limit = 25,
      args = ["%" + term + "%", filter],
      where =
        "(vehicle ILIKE $1 OR customer_name ILIKE $1 OR COALESCE(order_id,'') ILIKE $1 OR provider_reference ILIKE $1) AND ($2='' OR status=$2)";
    res.json({
      items: await d.rows(
        pool,
        `SELECT * FROM zc_operational_services WHERE ${where} ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`,
        [...args, limit, (page - 1) * limit],
      ),
      total: Number(
        (
          await d.one(
            pool,
            `SELECT count(*) n FROM zc_operational_services WHERE ${where}`,
            args,
          )
        ).n,
      ),
      page,
      limit,
    });
  });
  app.get("/api/operational-services/:id", staff, async (req, res) => {
    const row = await get(pool, req.params.id);
    const history = await d.rows(
      pool,
      "SELECT actor,action,created_at,detail FROM zc_audit WHERE entity_type='operational_service' AND entity_id=$1 ORDER BY id DESC",
      [row.id],
    );
    res.json({ ...row, history });
  });
  app.post("/api/operational-services", staff, async (req, res) => {
    const row = await transaction(pool, async (db) => {
      const body = req.body;
      if (body.kind !== undefined && body.kind !== "blocking")
        fail(400, "Serviço operacional inválido.");
      if (body.technician_id !== undefined)
        fail(
          400,
          "Bloqueio é executado pela Rede Veículo, sem atribuição ao técnico.",
        );
      const orderId = d.string(body.order_id || "", "OS de referência", 100),
        order = orderId ? await o.get(db, orderId) : null;
      if (order?.parent_order_id)
        fail(400, "Vincule o bloqueio à OS principal.");
      const vehicle = d.vehicle(
        d.string(
          body.vehicle ?? order?.vehicle ?? "",
          "Placa ou chassi",
          40,
          true,
        ),
      );
      if (!/^[A-Z0-9]{6,30}$/.test(vehicle))
        fail(400, "Informe uma placa ou chassi válido.");
      if (
        order &&
        ![d.vehicle(order.vehicle), d.vehicle(order.chassis)].includes(vehicle)
      )
        fail(400, "O veículo não corresponde à OS de referência.");
      const state = status(body.status || "registered");
      if (state === "cancelled")
        fail(400, "Registre o serviço antes de cancelar.");
      const row = await o.insert(db, "zc_operational_services", {
        id: randomUUID(),
        order_id: order?.id || null,
        vehicle,
        customer_name:
          d.string(body.customer_name ?? "", "Associado", 200) ||
          order?.customer_name ||
          "",
        status: state,
        notes: d.string(body.notes ?? "", "Observações operacionais", 3000),
        provider_reference: d.string(
          body.provider_reference ?? "",
          "Protocolo da Rede Veículo",
          200,
        ),
        created_by: actor(req),
        updated_by: actor(req),
        completed_at: state === "completed" ? d.now() : null,
      });
      await d.audit(
        db,
        actor(req),
        "operational_service_created",
        "operational_service",
        row.id,
        { order_id: row.order_id, after: row },
      );
      return row;
    });
    res.status(201).json(row);
  });
  app.patch("/api/operational-services/:id", staff, async (req, res) => {
    const row = await transaction(pool, async (db) => {
      const old = await get(db, req.params.id, true),
        body = req.body;
      if (body.version !== old.version)
        fail(409, "O registro mudou. Atualize a tela antes de salvar.");
      for (const key of [
        "kind",
        "provider",
        "vehicle",
        "order_id",
        "technician_id",
        "customer_name",
      ])
        if (body[key] !== undefined)
          fail(
            400,
            "Altere apenas situação, observações e protocolo deste registro.",
          );
      const state =
        body.status === undefined ? old.status : status(body.status);
      const allowed = {
        registered: ["registered", "in_progress", "completed", "cancelled"],
        in_progress: ["in_progress", "completed", "cancelled"],
        completed: ["completed"],
        cancelled: ["cancelled"],
      };
      if (!allowed[old.status].includes(state))
        fail(
          409,
          "Este serviço já foi encerrado ou não permite essa mudança de situação.",
        );
      const next = await o.update(
        db,
        "zc_operational_services",
        "id",
        old.id,
        {
          status: state,
          notes:
            body.notes === undefined
              ? old.notes
              : d.string(body.notes, "Observações operacionais", 3000),
          provider_reference:
            body.provider_reference === undefined
              ? old.provider_reference
              : d.string(
                  body.provider_reference,
                  "Protocolo da Rede Veículo",
                  200,
                ),
          updated_by: actor(req),
          updated_at: d.now(),
          completed_at:
            state === "completed" ? old.completed_at || d.now() : null,
        },
        true,
      );
      await d.audit(
        db,
        actor(req),
        "operational_service_updated",
        "operational_service",
        old.id,
        { order_id: old.order_id, before: old, after: next },
      );
      return next;
    });
    res.json(row);
  });
}
module.exports = { configureOperational };
