const { randomUUID, createHash, timingSafeEqual } = require("node:crypto");
const { transaction } = require("./database");
const { fail, integer, text, serials } = require("./errors");
const { moveWithin } = require("./inventory");
const context = require("./context");
const hash = (value) => createHash("sha256").update(value).digest();
function configureZenControl(app, pool, env) {
  const base = "/api/integrations/zencontrol";
  const authorize = (req, res, next) => {
    const secret = env.ZENCONTROL_INTEGRATION_SECRET;
    if (!secret || secret.length < 32)
      fail(503, "Integração ZenControl não configurada.");
    const given = String(req.get("Authorization") || "").replace(
      /^Bearer /,
      "",
    );
    if (!timingSafeEqual(hash(given), hash(secret)))
      fail(401, "Integração não autorizada.");
    res.set("Cache-Control", "no-store");
    next();
  };
  app.get(base + "/catalog", authorize, async (req, res) =>
    res.json({
      technicians: (
        await pool.query(
          "SELECT id,nome FROM tecnicos WHERE ativo=true ORDER BY nome,id",
        )
      ).rows,
      products: (
        await pool.query(
          "SELECT id,nome,categoria FROM produtos ORDER BY categoria,nome,id",
        )
      ).rows,
    }),
  );
  app.get(base + "/technicians/:id/items", authorize, async (req, res) => {
    const tid = integer(req.params.id, "Técnico");
    if (
      !(
        await pool.query("SELECT 1 FROM tecnicos WHERE id=$1 AND ativo=true", [
          tid,
        ])
      ).rowCount
    )
      fail(404, "Técnico ativo não encontrado.");
    res.json({
      items: (
        await pool.query(
          "SELECT e.codigo_serial,e.produto_id,e.tecnico_id,p.nome produto,p.categoria FROM equipamentos_seriais e JOIN produtos p ON p.id=e.produto_id WHERE e.tecnico_id=$1 AND e.status='TECNICO' AND NOT e.arquivado ORDER BY p.nome,e.codigo_serial",
          [tid],
        )
      ).rows,
    });
  });
  app.post(base + "/installations", authorize, async (req, res) => {
    const body = req.body || {},
      key = text(req.get("Idempotency-Key"), "Idempotência", 160);
    if (key.length < 12) fail(400, "Chave de idempotência inválida.");
    const payload = {
      source_system: text(body.source_system, "Origem", 80),
      order_id: text(body.order_id, "OS", 100),
      submission_id: text(body.submission_id, "Envio", 100),
      technician_id: integer(body.technician_id, "Técnico"),
      serials: serials(body.serials).sort(),
      operator: text(body.operator, "Operador", 200),
    };
    if (payload.serials.length > 20)
      fail(400, "Limite de 20 equipamentos por serviço.");
    const fingerprint = hash(JSON.stringify(payload)).toString("hex");
    const receipt = await context.run(
      { operador: "ZenControl: " + payload.operator },
      () =>
        transaction(pool, async (client) => {
          // Claim the request inside the same transaction. Concurrent retries wait for
          // this row and receive the committed receipt instead of repeating movement.
          const receiptId = randomUUID();
          const claimed = await client.query(
            "INSERT INTO zencontrol_installations(id,idempotency_key,source_system,order_id,submission_id,technician_id,request_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id",
            [
              receiptId,
              key,
              payload.source_system,
              payload.order_id,
              payload.submission_id,
              payload.technician_id,
              fingerprint,
              "{}",
            ],
          );
          if (!claimed.rowCount) {
            const previous = (
              await client.query(
                "SELECT * FROM zencontrol_installations WHERE idempotency_key=$1",
                [key],
              )
            ).rows[0];
            if (!previous)
              fail(409, "Esta OS já registrou uma instalação no estoque.");
            if (previous.request_hash !== fingerprint)
              fail(
                409,
                "A chave de idempotência já foi usada com outros dados.",
              );
            return previous.result;
          }
          const items = (
            await client.query(
              "SELECT codigo_serial,produto_id,tecnico_id,status,arquivado FROM equipamentos_seriais WHERE codigo_serial=ANY($1::text[]) ORDER BY produto_id,codigo_serial FOR UPDATE",
              [payload.serials],
            )
          ).rows;
          if (
            items.length !== payload.serials.length ||
            items.some(
              (e) =>
                e.status !== "TECNICO" ||
                e.tecnico_id !== payload.technician_id ||
                e.arquivado,
            )
          )
            fail(
              409,
              "Todos os IMEIs precisam estar disponíveis na carga do técnico responsável. Nenhuma instalação foi registrada.",
            );
          const models = [...new Set(items.map((e) => e.produto_id))].sort(
            (a, b) => a - b,
          );
          for (const id of models)
            await moveWithin(client, "instalar", {
              produto_id: id,
              tecnico_id: payload.technician_id,
              seriais: items
                .filter((e) => e.produto_id === id)
                .map((e) => e.codigo_serial),
            });
          const result = {
            success: true,
            receipt_id: receiptId,
            idempotency_key: key,
            source_system: payload.source_system,
            order_id: payload.order_id,
            submission_id: payload.submission_id,
            technician_id: payload.technician_id,
            serials: payload.serials,
            status: "INSTALADO",
            confirmed_at: new Date().toISOString(),
          };
          await client.query(
            "UPDATE zencontrol_installations SET result=$1::jsonb WHERE id=$2",
            [JSON.stringify(result), receiptId],
          );
          return result;
        }),
    );
    res.json(receipt);
  });
}
module.exports = { configureZenControl };
