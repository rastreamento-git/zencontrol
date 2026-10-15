const { configuration } = require("../src/config");
const { createPool, transaction } = require("../src/database");
const { create, insert } = require("../src/orders");
const d = require("../src/domain");
async function demo(pool) {
  if (Number((await d.one(pool, "SELECT count(*) n FROM zc_orders")).n))
    throw Error("Demonstração exige uma base vazia.");
  const techs = [];
  await transaction(pool, async (db) => {
    for (const name of [
      "Equipe Alfa · Exemplo",
      "Equipe Beta · Exemplo",
      "Equipe Gama · Exemplo",
    ])
      techs.push(
        await insert(db, "zc_technicians", {
          name,
          tags: "Instalação · Manutenção",
          address: "Região fictícia",
          price_install: 8000,
          price_maintenance: 6000,
          price_removal: 5000,
          price_visit: 3500,
        }),
      );
  });
  for (let i = 0; i < 24; i++) {
    const day = new Date(d.today() + "T12:00:00Z");
    day.setUTCDate(day.getUTCDate() + (i % 6) - 2);
    const o = await create(
      pool,
      {
        vehicle: "EXA" + String(i).padStart(4, "0"),
        customer_name: "Associado exemplo " + (i + 1),
        service: d.services[i % 3],
        technician_id: techs[i % 3].id,
        scheduled_at:
          day.toISOString().slice(0, 10) +
          "T" +
          String(8 + (i % 9)).padStart(2, "0") +
          ":00",
        location: "Endereço fictício para demonstração",
        status: i % 4 ? "AGENDADO" : "PENDENTE",
      },
      "demonstração",
    );
    if (i % 3 === 0)
      await pool.query(
        "UPDATE zc_orders SET status='CONCLUÍDO',completed_at=$1,closed_by='demonstração' WHERE id=$2",
        [d.today(), o.id],
      );
  }
}
if (require.main === module) {
  const cfg = configuration(),
    pool = createPool(cfg);
  demo(pool)
    .then(() => console.log("Dados fictícios criados."))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
module.exports = { demo };
