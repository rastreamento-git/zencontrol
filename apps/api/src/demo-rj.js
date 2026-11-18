// This flag is a boolean passed only by the isolated homologation initializer.
// Never trust an input field or a customer-supplied name to identify demo data.
const actor="Demonstração RJ - FICTÍCIO";
function isDemoOrder(cfg,order,next=order){
 if(cfg?.DEMO_RJ_ISOLATED!==true||!order||!next||order.created_by!==actor||order.sga_id||next.sga_id||order.parent_order_id)return false;
 const match=/^Cliente RJ (\d{3}) — FICTÍCIO \/ NÃO ATENDER$/.exec(order.customer_name||"");
 if(!match)return false;
 const n=Number(match[1]),plate="RJX"+Math.floor(n/10)+"Z"+String(n%10).padStart(2,"0");
 return n>=1&&n<=50&&order.vehicle===plate&&next.vehicle===plate&&next.customer_name===order.customer_name;
}
// Additional OS inherit the demo identity only from their stored principal.
async function isDemoAttendance(db,cfg,order){
 if(isDemoOrder(cfg,order))return true;
 if(cfg?.DEMO_RJ_ISOLATED!==true||!order?.parent_order_id||order.created_by!==actor||order.sga_id)return false;
 const parent=await require("./domain").one(db,"SELECT * FROM zc_orders WHERE id=$1 AND deleted_at=''",[order.parent_order_id]);
 return isDemoOrder(cfg,parent)&&order.vehicle===parent.vehicle&&order.customer_name===parent.customer_name;
}
module.exports={actor,isDemoOrder,isDemoAttendance};
