const d = require("./domain");
const { transaction } = require("./database");
function tier(order, month = d.today().slice(0,7)) {
  if (!["CONCLUÍDO","CANCELADO"].includes(order.status)) return "HOT";
  const dates = [order.created_date || order.term,order.completed_at].map(v=>d.date(String(v||"").slice(0,10))).filter(Boolean).sort();
  if (!dates.length) return "HOT";
  const last = dates.at(-1);
  const age = (Number(month.slice(0,4))-Number(last.slice(0,4)))*12+Number(month.slice(5,7))-Number(last.slice(5,7));
  return age >= 4 ? "COLD" : age >= 1 ? "WARM" : "HOT";
}
async function reconcile(pool, month = d.today().slice(0,7), dry = false, actor = "Política automática de armazenamento") {
  return transaction(pool, async db => {
    const changes = await d.rows(db,"SELECT id,archive AS \"from\",zc_storage_tier(status,created_date,completed_at,$1) AS \"to\" FROM zc_orders WHERE deleted_at='' AND archive IS DISTINCT FROM zc_storage_tier(status,created_date,completed_at,$1)",[month]);
    if (!dry && changes.length) {
      await db.query("UPDATE zc_orders SET archive=zc_storage_tier(status,created_date,completed_at,$1) WHERE deleted_at='' AND archive IS DISTINCT FROM zc_storage_tier(status,created_date,completed_at,$1)",[month]);
      await d.audit(db,actor,"archive_month","system",month,{count:changes.length});
    }
    return {month,count:changes.length,dry_run:dry,changes};
  });
}
module.exports={tier,reconcile};
