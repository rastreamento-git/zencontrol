require("dotenv").config({ quiet: true });
const { createPool, transaction } = require("../src/database");
const { syncStock } = require("../src/inventory");
async function reconcile(pool, apply = false) {
  return transaction(pool, async (client) => {
    const invalid =
      await client.query(`SELECT e.codigo_serial,e.status FROM equipamentos_seriais e LEFT JOIN produtos p ON p.id=e.produto_id LEFT JOIN tecnicos t ON t.id=e.tecnico_id
      WHERE p.id IS NULL OR e.status IS NULL OR e.status NOT IN ('MATRIZ','TECNICO','INSTALADO','TRIAGEM','SUCATA')
      OR (e.status='TECNICO' AND (t.id IS NULL OR NOT t.ativo))`);
    if (invalid.rowCount)
      throw new Error(
        "Há seriais com modelo/técnico/status inválido. Corrija-os manualmente antes da reconciliação.",
      );
    const matrix =
      await client.query(`SELECT p.id,p.nome,p.quantidade_matriz AS registrado,COUNT(e.codigo_serial)::integer AS esperado
      FROM produtos p LEFT JOIN equipamentos_seriais e ON e.produto_id=p.id AND e.status='MATRIZ' GROUP BY p.id HAVING p.quantidade_matriz<>COUNT(e.codigo_serial)`);
    const tech =
      await client.query(`SELECT COALESCE(et.tecnico_id,s.tecnico_id) AS tecnico_id,COALESCE(et.produto_id,s.produto_id) AS produto_id,
      COALESCE(et.quantidade,0) AS registrado,COALESCE(s.qtd,0)::integer AS esperado
      FROM estoque_tecnicos et FULL JOIN (SELECT tecnico_id,produto_id,COUNT(*) AS qtd FROM equipamentos_seriais WHERE status='TECNICO' GROUP BY tecnico_id,produto_id) s
      ON s.tecnico_id=et.tecnico_id AND s.produto_id=et.produto_id WHERE COALESCE(et.quantidade,0)<>COALESCE(s.qtd,0)`);
    if (apply)
      await syncStock(
        client,
        (await client.query("SELECT id FROM produtos ORDER BY id")).rows.map(
          (p) => p.id,
        ),
      );
    return { aplicado: apply, matriz: matrix.rows, tecnicos: tech.rows };
  });
}
if (require.main === module) {
  const pool = createPool();
  reconcile(pool, process.argv.includes("--apply"))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error("Reconciliação falhou:", error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
module.exports = { reconcile };
