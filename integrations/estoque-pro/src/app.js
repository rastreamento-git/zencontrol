const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { configureAuth } = require("./auth");
const { configureAdmin } = require("./admin");
const { configureTrace } = require("./trace");
const { configureZenControl } = require("./zencontrol");
const context = require("./context");
const { fail, integer, text, HttpError } = require("./errors");
const { transaction } = require("./database");
const {
  move,
  receive,
  evaluate,
  product,
  technician,
  record,
  syncStock,
} = require("./inventory");
function createApp(pool, env = process.env) {
  const app = express();
  app.disable("x-powered-by");
  const origins = (
    env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173"
  )
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (origins.includes("*"))
    throw new Error("CORS_ORIGINS exige origens explícitas, sem curinga.");
  if (env.NODE_ENV === "production" && !env.CORS_ORIGINS)
    throw new Error("Configure CORS_ORIGINS em produção.");
  if (env.TRUST_PROXY)
    app.set("trust proxy", integer(env.TRUST_PROXY, "TRUST_PROXY"));
  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        cb(
          origin && !origins.includes(origin)
            ? new HttpError(403, "Origem não permitida.")
            : null,
          true,
        );
      },
    }),
  );
  app.use("/api/admin/restore", express.json({ limit: "32mb" }));
  app.use(express.json({ limit: "512kb" }));
  app.get("/healthz", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      if (req.body === undefined) req.body = {};
      if (
        req.body === null ||
        Array.isArray(req.body) ||
        typeof req.body !== "object"
      )
        return next(new HttpError(400, "Informe um objeto JSON válido."));
    }
    next();
  });
  configureZenControl(app, pool, env);
  const auth = configureAuth(app, env, pool);
  app.locals.ready = auth.ready;
  app.use("/api", (req, res, next) =>
    context.run({ operador: req.user?.login }, next),
  );
  configureAdmin(app, pool, auth);
  configureTrace(app, pool);
  const get = (route, sql) =>
    app.get(`/api/${route}`, async (req, res) =>
      res.json((await pool.query(sql)).rows),
    );
  get("produtos", "SELECT * FROM produtos ORDER BY categoria,nome,id");
  get("tecnicos", "SELECT * FROM tecnicos WHERE ativo=true ORDER BY nome,id");
  get(
    "estoque-tecnicos",
    `SELECT et.*,t.nome AS tecnico_nome,t.estoque_minimo,p.nome AS produto_nome,p.categoria
    FROM estoque_tecnicos et JOIN tecnicos t ON t.id=et.tecnico_id JOIN produtos p ON p.id=et.produto_id WHERE t.ativo=true ORDER BY t.nome,p.nome`,
  );
  get(
    "logs",
    `SELECT m.id,m.tipo,m.produto_id,m.tecnico_id,p.nome AS produto,t.nome AS tecnico,m.quantidade,m.data,m.operador
    FROM movimentacoes m LEFT JOIN produtos p ON p.id=m.produto_id LEFT JOIN tecnicos t ON t.id=m.tecnico_id ORDER BY m.data DESC,m.id DESC LIMIT 200`,
  );
  app.get("/api/imeis", async (req, res) => {
    const showArchived = req.query.incluir_arquivados === "true";
    res.json(
      (
        await pool.query(
          `SELECT e.codigo_serial,e.produto_id,e.tecnico_id,e.status,e.arquivado,e.data_atualizacao,p.nome AS produto,p.categoria,t.nome AS tecnico
      FROM equipamentos_seriais e JOIN produtos p ON p.id=e.produto_id LEFT JOIN tecnicos t ON t.id=e.tecnico_id
      WHERE ($1::boolean OR NOT e.arquivado) ORDER BY e.data_atualizacao DESC,e.codigo_serial`,
          [showArchived],
        )
      ).rows,
    );
  });
  app.get("/api/imeis/:codigo/historico", async (req, res) => {
    const code = text(req.params.codigo, "IMEI/serial", 128);
    res.json(
      (
        await pool.query(
          `SELECT e.*,m.tipo,m.operador,p.nome AS produto,t.nome AS tecnico FROM eventos_seriais e
      LEFT JOIN movimentacoes m ON m.id=e.movimentacao_id LEFT JOIN produtos p ON p.id=e.produto_id LEFT JOIN tecnicos t ON t.id=e.tecnico_id
      WHERE e.codigo_serial=$1 ORDER BY e.data DESC,e.id DESC`,
          [code],
        )
      ).rows,
    );
  });
  app.post("/api/produtos", async (req, res) => {
    const nome = text(req.body.nome, "Nome do modelo");
    const categoria =
      req.body.categoria === undefined
        ? "RASTREADOR"
        : text(req.body.categoria, "Categoria", 40).toUpperCase();
    const minimo = integer(req.body.estoque_minimo ?? 5, "Estoque mínimo", 0);
    const row = await transaction(pool, async (client) => {
      const duplicates = await client.query(
        "SELECT id FROM produtos WHERE lower(nome)=lower($1) AND categoria=$2",
        [nome, categoria],
      );
      if (duplicates.rowCount)
        fail(409, "Já existe um modelo com este nome na categoria.");
      return (
        await client.query(
          "INSERT INTO produtos (nome,categoria,quantidade_matriz,estoque_minimo) VALUES ($1,$2,0,$3) RETURNING *",
          [nome, categoria, minimo],
        )
      ).rows[0];
    });
    res.status(201).json({ success: true, produto: row });
  });
  // Reclassification changes the model, keeps ownership/state and audits both
  // models. Serial identity and historical events are never rewritten.
  app.put("/api/imeis/:codigo", async (req, res) => {
    const code = text(req.params.codigo, "IMEI/serial", 128);
    const targetId = integer(req.body.produto_id, "Modelo");
    const result = await transaction(pool, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM equipamentos_seriais WHERE codigo_serial=$1 FOR UPDATE",
        [code],
      );
      if (!rows.length) fail(404, "Serial não encontrado.");
      const row = rows[0];
      await product(client, targetId);
      if (row.produto_id === targetId)
        return { success: true, alterado: false };
      await client.query(
        "UPDATE equipamentos_seriais SET produto_id=$1,data_atualizacao=CURRENT_TIMESTAMP WHERE codigo_serial=$2",
        [targetId, code],
      );
      await record(
        client,
        "RECLASSIFICACAO_ORIGEM",
        row.produto_id,
        row.tecnico_id,
        [code],
        row.status,
        row.status,
      );
      await record(
        client,
        "RECLASSIFICACAO_DESTINO",
        targetId,
        row.tecnico_id,
        [code],
        row.status,
        row.status,
      );
      await syncStock(client, [row.produto_id, targetId]);
      return { success: true, alterado: true };
    });
    res.json(result);
  });
  app.delete("/api/produtos/:id", async (req, res) => {
    const id = integer(req.params.id, "Modelo");
    await transaction(pool, async (client) => {
      await product(client, id);
      const linked = await client.query(
        `SELECT 1 FROM equipamentos_seriais WHERE produto_id=$1 UNION ALL SELECT 1 FROM movimentacoes WHERE produto_id=$1
        UNION ALL SELECT 1 FROM eventos_seriais WHERE produto_id=$1 UNION ALL SELECT 1 FROM estoque_tecnicos WHERE produto_id=$1 AND quantidade>0 LIMIT 1`,
        [id],
      );
      if (linked.rowCount)
        fail(
          409,
          "Este modelo possui equipamentos ou histórico. A exclusão comprometeria o rastreamento.",
        );
      await client.query("DELETE FROM estoque_tecnicos WHERE produto_id=$1", [
        id,
      ]);
      await client.query("DELETE FROM produtos WHERE id=$1", [id]);
    });
    res.json({ success: true });
  });
  app.post("/api/tecnicos", async (req, res) => {
    const nome = text(req.body.nome, "Nome do técnico");
    const row = await transaction(pool, async (client) => {
      const existing = await client.query(
        "SELECT id FROM tecnicos WHERE lower(nome)=lower($1) AND ativo=true",
        [nome],
      );
      if (existing.rowCount)
        fail(409, "Já existe um técnico ativo com este nome.");
      return (
        await client.query(
          "INSERT INTO tecnicos (nome) VALUES ($1) RETURNING *",
          [nome],
        )
      ).rows[0];
    });
    res.status(201).json({ success: true, tecnico: row });
  });
  app.delete("/api/tecnicos/:id", async (req, res) => {
    const id = integer(req.params.id, "Técnico");
    await transaction(pool, async (client) => {
      await technician(client, id);
      const stock = await client.query(
        "SELECT 1 FROM equipamentos_seriais WHERE tecnico_id=$1 AND status='TECNICO' UNION ALL SELECT 1 FROM estoque_tecnicos WHERE tecnico_id=$1 AND quantidade>0 LIMIT 1",
        [id],
      );
      if (stock.rowCount)
        fail(
          409,
          "O técnico ainda possui equipamentos. Devolva-os à matriz primeiro.",
        );
      await client.query("UPDATE tecnicos SET ativo=false WHERE id=$1", [id]);
    });
    res.json({ success: true });
  });
  for (const action of ["entrada", "transferir", "instalar", "estorno"])
    app.post(`/api/${action}`, async (req, res) =>
      res.json(await move(pool, action, req.body)),
    );
  app.post("/api/triagem/receber", async (req, res) =>
    res.json(await receive(pool, req.body)),
  );
  app.post("/api/triagem/avaliar", async (req, res) =>
    res.json(await evaluate(pool, req.body)),
  );
  // Kept for frontend compatibility: archives instead of permanently deleting serial identities.
  app.delete("/api/limpeza-instalados", async (req, res) => {
    const count = await transaction(pool, async (client) => {
      const result =
        await client.query(`UPDATE equipamentos_seriais SET arquivado=true WHERE status='INSTALADO' AND NOT arquivado
        AND data_atualizacao < CURRENT_TIMESTAMP - INTERVAL '30 days' RETURNING *`);
      const groups = new Map();
      for (const row of result.rows) {
        const key = `${row.produto_id}:${row.tecnico_id}`;
        if (!groups.has(key)) groups.set(key, { row, codes: [] });
        groups.get(key).codes.push(row.codigo_serial);
      }
      for (const { row, codes } of groups.values())
        await record(
          client,
          "ARQUIVAMENTO_INSTALADO",
          row.produto_id,
          row.tecnico_id,
          codes,
          "INSTALADO",
          "INSTALADO",
        );
      return result.rowCount;
    });
    res.json({ success: true, arquivados: count, apagados: 0 });
  });
  app.put("/api/configurar-alerta", async (req, res) => {
    const { tipo } = req.body;
    const limit = integer(req.body.novo_limite, "Estoque mínimo", 0);
    if (!["PRODUTO", "TECNICO", "CATEGORIA"].includes(tipo))
      fail(400, "Tipo de alerta inválido.");
    const target =
      tipo === "CATEGORIA"
        ? text(req.body.id, "Categoria", 40).toUpperCase()
        : integer(req.body.id, "Alvo");
    await transaction(pool, async (client) => {
      const sql =
        tipo === "CATEGORIA"
          ? "UPDATE produtos SET estoque_minimo=$1 WHERE categoria=$2"
          : tipo === "PRODUTO"
            ? "UPDATE produtos SET estoque_minimo=$1 WHERE id=$2"
            : "UPDATE tecnicos SET estoque_minimo=$1 WHERE id=$2 AND ativo=true";
      if (!(await client.query(sql, [limit, target])).rowCount)
        fail(404, "Nenhum alvo encontrado para este alerta.");
    });
    res.json({ success: true });
  });
  app.get("/api/dashboard", async (req, res) => {
    const kpis = await pool.query(`SELECT
      COALESCE(SUM(quantidade) FILTER (WHERE data>=CURRENT_DATE),0)::integer AS diario,
      COALESCE(SUM(quantidade) FILTER (WHERE data>=date_trunc('week',CURRENT_DATE)),0)::integer AS semanal,
      COALESCE(SUM(quantidade) FILTER (WHERE data>=date_trunc('month',CURRENT_DATE)),0)::integer AS mensal,
      COALESCE(SUM(quantidade) FILTER (WHERE data>=date_trunc('quarter',CURRENT_DATE)),0)::integer AS trimestral
      FROM movimentacoes WHERE tipo='USO_FINAL'`);
    const graph =
      await pool.query(`SELECT TO_CHAR(d.dia,'DD/MM') AS dia,COALESCE(SUM(m.quantidade),0)::integer AS instalacoes
      FROM generate_series(CURRENT_DATE-6,CURRENT_DATE,INTERVAL '1 day') d(dia)
      LEFT JOIN movimentacoes m ON m.data>=d.dia AND m.data<d.dia+INTERVAL '1 day' AND m.tipo='USO_FINAL'
      GROUP BY d.dia ORDER BY d.dia`);
    const techs =
      await pool.query(`SELECT t.id,t.nome,COALESCE(SUM(m.quantidade),0)::integer AS total_mes,
      ROUND(COALESCE(SUM(m.quantidade),0)/30.0,2) AS media_diaria FROM tecnicos t LEFT JOIN movimentacoes m
      ON m.tecnico_id=t.id AND m.tipo='USO_FINAL' AND m.data>=CURRENT_TIMESTAMP-INTERVAL '30 days'
      WHERE t.ativo=true GROUP BY t.id,t.nome ORDER BY total_mes DESC,t.nome`);
    res.json({
      kpis: kpis.rows[0],
      grafico: graph.rows,
      tecnicos: techs.rows.map((t) => ({
        ...t,
        media_diaria: Number(t.media_diaria),
      })),
    });
  });
  app.get("/api/previsao-compras", async (req, res) => {
    const result =
      await pool.query(`SELECT p.id,p.nome,p.categoria,p.estoque_minimo,p.quantidade_matriz,COALESCE(SUM(m.quantidade),0)::integer AS uso_30_dias
      FROM produtos p LEFT JOIN movimentacoes m ON m.produto_id=p.id AND m.tipo='USO_FINAL' AND m.data>=CURRENT_TIMESTAMP-INTERVAL '30 days' GROUP BY p.id`);
    res.json(
      result.rows.map((p) => {
        const cmd = p.uso_30_dias / 30;
        const ponto_pedido = Math.max(p.estoque_minimo, Math.ceil(cmd * 22.5));
        const sugerido = Math.max(
          0,
          Math.ceil(
            Math.max(p.estoque_minimo, cmd * 52.5) - p.quantidade_matriz,
          ),
        );
        return {
          ...p,
          cmd: Number(cmd.toFixed(2)),
          ponto_pedido,
          sugerido,
          status: p.quantidade_matriz <= ponto_pedido ? "URGENTE" : "OK",
        };
      }),
    );
  });
  app.use((req, res) =>
    res.status(404).json({ error: "Rota não encontrada." }),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error.status || 500;
    let message =
      error instanceof HttpError
        ? error.message
        : "Falha interna. Tente novamente ou consulte o administrador.";
    if (error.type === "entity.parse.failed") {
      status = 400;
      message = "JSON inválido.";
    }
    if (error.type === "entity.too.large") {
      status = 413;
      message = "Lote muito grande.";
    }
    if (["23505", "23503", "23514"].includes(error.code)) {
      status = 409;
      message = "A operação viola a integridade do estoque. Confira os dados.";
    }
    if (["40001", "40P01", "55P03", "57014"].includes(error.code)) {
      status = 409;
      message = "Estoque ocupado. Atualize a lista e tente novamente.";
    }
    if (status >= 500)
      console.error(
        "Falha na API:",
        req.method,
        req.path,
        error.code || error.name,
      );
    res.status(status).json({
      error: message,
      ...(["40001", "40P01", "55P03", "57014"].includes(error.code)
        ? { code: "STOCK_BUSY", retryable: true }
        : {}),
    });
  });
  return app;
}
module.exports = { createApp };
