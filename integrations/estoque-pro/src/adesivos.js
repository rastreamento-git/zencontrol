const { createHash } = require("node:crypto");
const { transaction } = require("./database");
const { fail, integer, text } = require("./errors");
const context = require("./context");
const product = {
  sga_code: "2371",
  name: "Adesivo Perfurado",
  unit: "unidade",
};
async function movement(db, input, key, operator) {
  const types = ["ENTRADA", "TRANSFERENCIA", "DEVOLUCAO", "APLICACAO"];
  const type = input.type;
  if (!types.includes(type)) fail(400, "Movimentação de adesivo inválida.");
  const quantity = integer(input.quantity, "Quantidade de adesivos"),
    technicianId =
      type === "ENTRADA" ? null : integer(input.technician_id, "Técnico");
  key = text(key, "Idempotência", 200);
  if (key.length < 12) fail(400, "Chave de idempotência inválida.");
  const payload = {
    type,
    quantity,
    technician_id: technicianId,
    order_id: input.order_id || "",
    source_system: input.source_system || "",
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  const old = (
    await db.query(
      "SELECT * FROM adesivo_movimentos WHERE idempotency_key=$1",
      [key],
    )
  ).rows[0];
  if (old) {
    if (old.request_hash !== fingerprint)
      fail(409, "Chave já utilizada com outros dados.");
    return old;
  }
  if (
    technicianId &&
    !(
      await db.query(
        "SELECT id FROM tecnicos WHERE id=$1 AND (ativo OR $2='DEVOLUCAO')",
        [technicianId, type],
      )
    ).rowCount
  )
    fail(409, "Técnico não disponível.");
  async function adjust(owner, tech, delta) {
    await db.query(
      "INSERT INTO adesivo_saldos(titular,tecnico_id) VALUES($1,$2) ON CONFLICT(titular) DO NOTHING",
      [owner, tech],
    );
    const r = await db.query(
      "UPDATE adesivo_saldos SET quantidade=quantidade+$2 WHERE titular=$1 AND quantidade::bigint+$2::bigint>=0 AND quantidade::bigint+$2::bigint<=2147483647 RETURNING quantidade",
      [owner, delta],
    );
    if (!r.rowCount)
      fail(
        409,
        owner === "MATRIZ"
          ? "Saldo de adesivos insuficiente na matriz."
          : "O técnico não possui adesivo Perfurado disponível na carga. Transfira o material no Estoque Pro antes de concluir.",
      );
  }
  if (type === "ENTRADA") await adjust("MATRIZ", null, quantity);
  if (type === "TRANSFERENCIA") {
    await adjust("MATRIZ", null, -quantity);
    await adjust("TECNICO:" + technicianId, technicianId, quantity);
  }
  if (type === "DEVOLUCAO") {
    await adjust("TECNICO:" + technicianId, technicianId, -quantity);
    await adjust("MATRIZ", null, quantity);
  }
  if (type === "APLICACAO")
    await adjust("TECNICO:" + technicianId, technicianId, -quantity);
  return (
    await db.query(
      "INSERT INTO adesivo_movimentos(tecnico_id,tipo,quantidade,operador,order_id,source_system,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        technicianId,
        type,
        quantity,
        operator,
        payload.order_id,
        payload.source_system,
        key,
        fingerprint,
      ],
    )
  ).rows[0];
}
function configureAdesivos(app, pool) {
  app.get("/api/adesivos", async (req, res) =>
    res.json({
      product,
      matrix: Number(
        (
          await pool.query(
            "SELECT quantidade FROM adesivo_saldos WHERE titular='MATRIZ'",
          )
        ).rows[0]?.quantidade || 0,
      ),
      technicians: (
        await pool.query(
          "SELECT t.id,t.nome,t.ativo,COALESCE(s.quantidade,0) quantidade FROM tecnicos t LEFT JOIN adesivo_saldos s ON s.tecnico_id=t.id ORDER BY t.nome,t.id",
        )
      ).rows,
      movements: (
        await pool.query(
          "SELECT m.*,t.nome tecnico FROM adesivo_movimentos m LEFT JOIN tecnicos t ON t.id=m.tecnico_id ORDER BY m.id DESC LIMIT 100",
        )
      ).rows,
    }),
  );
  app.post("/api/adesivos/movements", async (req, res) => {
    if (!["ENTRADA", "TRANSFERENCIA", "DEVOLUCAO"].includes(req.body.type))
      fail(400, "Aplicações são confirmadas pela OS no ZenControl.");
    const result = await transaction(pool, (db) =>
      movement(
        db,
        {
          type: req.body.type,
          quantity: req.body.quantity,
          technician_id: req.body.technician_id,
        },
        req.get("Idempotency-Key"),
        context.getStore()?.operador || req.user.login,
      ),
    );
    res.json({ success: true, movement: result });
  });
}
module.exports = { configureAdesivos, movement, product };
