const { fail, integer, text } = require("./errors");
const statuses = [
  "MATRIZ",
  "TECNICO",
  "INSTALADO",
  "TRIAGEM",
  "SUCATA",
  "CANCELADO",
];
const base = `WITH removed AS (
 SELECT DISTINCT ON(ev.codigo_serial) ev.codigo_serial,ev.produto_id,ev.tecnico_id,ev.status_novo AS status,
 (m.tipo='ARQUIVAMENTO_INSTALADO') AS arquivado,ev.data AS data_atualizacao,m.operador
 FROM eventos_seriais ev LEFT JOIN movimentacoes m ON m.id=ev.movimentacao_id
 WHERE NOT EXISTS (SELECT 1 FROM equipamentos_seriais s WHERE s.codigo_serial=ev.codigo_serial)
 ORDER BY ev.codigo_serial,ev.data DESC,ev.id DESC
), records AS (
 SELECT e.codigo_serial,e.produto_id,e.tecnico_id,e.status,e.arquivado,
 COALESCE(last_event.data,e.data_atualizacao) AS data_atualizacao,'cadastro'::text AS origem,last_event.operador
 FROM equipamentos_seriais e
 LEFT JOIN LATERAL (
  SELECT ev.data,m.operador FROM eventos_seriais ev LEFT JOIN movimentacoes m ON m.id=ev.movimentacao_id
  WHERE ev.codigo_serial=e.codigo_serial ORDER BY ev.data DESC,ev.id DESC LIMIT 1
 ) last_event ON true
 UNION ALL SELECT codigo_serial,produto_id,tecnico_id,status,COALESCE(arquivado,false),data_atualizacao,'historico'::text,operador FROM removed
), enriched AS (
 SELECT r.*,p.nome AS produto,COALESCE(NULLIF(p.categoria,''),'SEM_TIPO') AS categoria,t.nome AS tecnico
 FROM records r LEFT JOIN produtos p ON p.id=r.produto_id LEFT JOIN tecnicos t ON t.id=r.tecnico_id
)`;
function configureTrace(app, pool) {
  app.get("/api/rastreabilidade", async (req, res) => {
    const page = integer(req.query.page ?? 1, "Página"),
      pageSize = integer(req.query.pageSize ?? 25, "Itens por página");
    if (pageSize > 100) fail(400, "Use no máximo 100 itens por página.");
    const status = req.query.status || "TODOS",
      archived = req.query.arquivo || "todos";
    if (status !== "TODOS" && !statuses.includes(status))
      fail(400, "Status inválido.");
    if (!["todos", "ativos", "arquivados"].includes(archived))
      fail(400, "Filtro de arquivamento inválido.");
    const params = [],
      parts = [];
    const add = (sql, value) => {
      params.push(value);
      parts.push(sql.replace("?", `$${params.length}`));
    };
    if (status !== "TODOS") add("status=?", status);
    if (req.query.categoria && req.query.categoria !== "TODOS")
      add(
        "categoria=?",
        text(req.query.categoria, "Categoria", 40).toUpperCase(),
      );
    if (req.query.tecnico_id)
      add("tecnico_id=?", integer(req.query.tecnico_id, "Técnico"));
    if (archived !== "todos")
      parts.push(archived === "arquivados" ? "arquivado" : "NOT arquivado");
    if (req.query.q !== undefined && typeof req.query.q !== "string")
      fail(400, "Pesquisa inválida.");
    if (req.query.q?.trim()) {
      const q = text(req.query.q, "Pesquisa", 128).replace(/[\\%_]/g, "\\$&");
      params.push(`%${q}%`);
      const index = params.length;
      parts.push(
        `concat_ws(' ',codigo_serial,produto,categoria,tecnico,status,operador) ILIKE $${index}`,
      );
    }
    const where = parts.length ? " WHERE " + parts.join(" AND ") : "";
    const filtered = (
      await pool.query(
        base + ` SELECT COUNT(*)::integer AS total FROM enriched${where}`,
        params,
      )
    ).rows[0].total;
    const pages = Math.max(1, Math.ceil(filtered / pageSize)),
      selected = Math.min(page, pages);
    const rows = (
      await pool.query(
        base +
          ` SELECT * FROM enriched${where} ORDER BY data_atualizacao DESC,codigo_serial LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, (selected - 1) * pageSize],
      )
    ).rows;
    const summary = (
      await pool.query(
        base +
          " SELECT status,COUNT(*)::integer AS total,COUNT(*) FILTER(WHERE arquivado)::integer AS arquivados FROM enriched GROUP BY status",
      )
    ).rows;
    const categories = (
      await pool.query(
        base + " SELECT DISTINCT categoria FROM enriched ORDER BY categoria",
      )
    ).rows.map((r) => r.categoria);
    const technicians = (
      await pool.query(
        base +
          " SELECT DISTINCT tecnico_id AS id,tecnico AS nome FROM enriched WHERE tecnico_id IS NOT NULL ORDER BY tecnico,tecnico_id",
      )
    ).rows;
    res.json({
      rows,
      total: filtered,
      page: selected,
      pageSize,
      pages,
      summary,
      categorias: categories,
      tecnicos: technicians,
    });
  });
}
module.exports = { configureTrace };
