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
module.exports={actor,isDemoOrder};
