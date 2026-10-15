const { fail, integer, serials, text } = require("./errors");
const { transaction } = require("./database");
const context = require("./context");
async function product(client, id) {
  const result = await client.query(
    "SELECT * FROM produtos WHERE id = $1 FOR UPDATE",
    [id],
  );
  if (!result.rowCount) fail(404, "Modelo não encontrado.");
  return result.rows[0];
}
async function technician(client, id) {
  const result = await client.query(
    "SELECT * FROM tecnicos WHERE id = $1 AND ativo = true FOR UPDATE",
    [id],
  );
  if (!result.rowCount) fail(404, "Técnico ativo não encontrado.");
  return result.rows[0];
}
async function items(client, codes) {
  const result = await client.query(
    "SELECT * FROM equipamentos_seriais WHERE codigo_serial = ANY($1::text[]) ORDER BY codigo_serial FOR UPDATE",
    [codes],
  );
  if (result.rowCount !== codes.length)
    fail(
      409,
      "Um ou mais seriais não estão cadastrados. Nenhum item foi alterado.",
    );
  return result.rows;
}
function verify(rows, productId, status, technicianId) {
  if (
    rows.some(
      (row) =>
        row.produto_id !== productId ||
        row.status !== status ||
        (technicianId !== undefined && row.tecnico_id !== technicianId),
    )
  ) {
    fail(
      409,
      "Um ou mais itens não pertencem ao modelo, status ou técnico selecionado. Atualize a lista. Nenhum item foi alterado.",
    );
  }
}
// Serials are the source of truth. Recalculate affected balances instead of trusting stale cached totals.
async function syncStock(client, productIds) {
  for (const id of [...new Set(productIds)].sort((a, b) => a - b)) {
    await client.query(
      "UPDATE produtos SET quantidade_matriz = (SELECT COUNT(*) FROM equipamentos_seriais WHERE produto_id = $1 AND status = 'MATRIZ') WHERE id = $1",
      [id],
    );
    await client.query(
      "UPDATE estoque_tecnicos SET quantidade = 0 WHERE produto_id = $1",
      [id],
    );
    await client.query(
      `INSERT INTO estoque_tecnicos (tecnico_id, produto_id, quantidade)
      SELECT tecnico_id, produto_id, COUNT(*) FROM equipamentos_seriais WHERE produto_id = $1 AND status = 'TECNICO'
      GROUP BY tecnico_id, produto_id ON CONFLICT (tecnico_id, produto_id) DO UPDATE SET quantidade = EXCLUDED.quantidade`,
      [id],
    );
  }
}
async function record(
  client,
  type,
  productId,
  techId,
  codes,
  fromStatus,
  toStatus,
) {
  const result = await client.query(
    "INSERT INTO movimentacoes (tipo, produto_id, tecnico_id, quantidade, operador) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [
      type,
      productId,
      techId,
      codes.length,
      context.getStore()?.operador || null,
    ],
  );
  await client.query(
    `INSERT INTO eventos_seriais (movimentacao_id,codigo_serial,produto_id,tecnico_id,status_anterior,status_novo)
    SELECT $1, unnest($2::text[]), $3, $4, $5, $6`,
    [result.rows[0].id, codes, productId, techId, fromStatus, toStatus],
  );
}
async function moveWithin(client, action, body) {
  const codes = serials(body.seriais);
  const productId = integer(body.produto_id, "Modelo");
  let techId;
  if (
    ["transferir", "instalar"].includes(action) ||
    (action === "estorno" && body.tipo_estorno === "TECNICO")
  )
    techId = integer(body.tecnico_id, "Técnico");
  if (
    action === "estorno" &&
    !["MATRIZ", "TECNICO"].includes(body.tipo_estorno)
  )
    fail(400, "Tipo de estorno inválido.");

  await product(client, productId);
  if (techId) await technician(client, techId);
  if (action === "entrada") {
    const existing = await client.query(
      "SELECT codigo_serial FROM equipamentos_seriais WHERE codigo_serial = ANY($1::text[])",
      [codes],
    );
    if (existing.rowCount)
      fail(
        409,
        "O lote contém seriais já cadastrados (incluindo arquivados). Nenhum item foi incluído.",
      );
    await client.query(
      "INSERT INTO equipamentos_seriais (codigo_serial,produto_id,status) SELECT unnest($1::text[]),$2,'MATRIZ'",
      [codes, productId],
    );
    await record(
      client,
      "ENTRADA_MATRIZ",
      productId,
      null,
      codes,
      null,
      "MATRIZ",
    );
  } else {
    const rows = await items(client, codes);
    let from,
      to,
      type,
      targetTech = null;
    if (action === "transferir") {
      from = "MATRIZ";
      to = "TECNICO";
      type = "CARGA_TECNICO";
      targetTech = techId;
    }
    if (action === "instalar") {
      from = "TECNICO";
      to = "INSTALADO";
      type = "USO_FINAL";
      targetTech = techId;
    }
    if (action === "estorno") {
      from = body.tipo_estorno;
      to = from === "MATRIZ" ? "CANCELADO" : "MATRIZ";
      type = from === "MATRIZ" ? "ESTORNO_MATRIZ" : "DEVOLUCAO_TECNICO";
    }
    verify(rows, productId, from, from === "TECNICO" ? techId : undefined);
    if (to === "CANCELADO")
      await client.query(
        "DELETE FROM equipamentos_seriais WHERE codigo_serial = ANY($1::text[])",
        [codes],
      );
    else
      await client.query(
        "UPDATE equipamentos_seriais SET status=$1,tecnico_id=$2,data_atualizacao=CURRENT_TIMESTAMP,arquivado=false WHERE codigo_serial = ANY($3::text[])",
        [to, targetTech, codes],
      );
    await record(client, type, productId, techId || null, codes, from, to);
  }
  await syncStock(client, [productId]);
  const field = {
    entrada: "registrados",
    transferir: "transferidos",
    instalar: "instalados",
    estorno: "estornados",
  }[action];
  return { success: true, [field]: codes.length };
}
async function move(pool, action, body) {
  return transaction(pool, (client) => moveWithin(client, action, body));
}

async function receive(pool, body) {
  const codes = serials(body.seriais);
  return transaction(pool, async (client) => {
    const rows = await items(client, codes);
    if (
      rows.some((r) => !["MATRIZ", "TECNICO", "INSTALADO"].includes(r.status))
    )
      fail(
        409,
        "Somente itens da matriz, com técnico ou instalados podem ir para triagem. Nenhum item foi alterado.",
      );
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.produto_id}:${row.tecnico_id}:${row.status}`;
      if (!groups.has(key)) groups.set(key, { row, codes: [] });
      groups.get(key).codes.push(row.codigo_serial);
    }
    await client.query(
      "UPDATE equipamentos_seriais SET status='TRIAGEM',tecnico_id=NULL,data_atualizacao=CURRENT_TIMESTAMP,arquivado=false WHERE codigo_serial = ANY($1::text[])",
      [codes],
    );
    for (const { row, codes: batch } of groups.values())
      await record(
        client,
        "RECEBIMENTO_TRIAGEM",
        row.produto_id,
        row.tecnico_id,
        batch,
        row.status,
        "TRIAGEM",
      );
    await syncStock(
      client,
      rows.map((r) => r.produto_id),
    );
    return { success: true, recebidos: codes.length };
  });
}
async function evaluate(pool, body) {
  const code = text(body.codigo_serial, "IMEI/serial", 128);
  if (typeof body.aprovado !== "boolean")
    fail(400, "A avaliação deve informar aprovado como booleano.");
  return transaction(pool, async (client) => {
    const [row] = await items(client, [code]);
    if (row.status !== "TRIAGEM")
      fail(409, "Este equipamento não está em triagem ou já foi avaliado.");
    if (
      body.produto_id !== undefined &&
      integer(body.produto_id, "Modelo") !== row.produto_id
    )
      fail(409, "Modelo não corresponde ao equipamento.");
    const target = body.aprovado ? "MATRIZ" : "SUCATA";
    await client.query(
      "UPDATE equipamentos_seriais SET status=$1,tecnico_id=NULL,data_atualizacao=CURRENT_TIMESTAMP,arquivado=false WHERE codigo_serial=$2",
      [target, code],
    );
    await record(
      client,
      body.aprovado ? "REUSO_APROVADO" : "REUSO_REPROVADO",
      row.produto_id,
      null,
      [code],
      "TRIAGEM",
      target,
    );
    await syncStock(client, [row.produto_id]);
    return { success: true };
  });
}
module.exports = {
  moveWithin,
  move,
  receive,
  evaluate,
  syncStock,
  product,
  technician,
  record,
};
