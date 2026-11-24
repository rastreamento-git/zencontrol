const d=require("./domain");
const {fail}=require("./errors");
const {roadRoute}=require("./technician-recommendations");
const {formatAddress}=require("../../../packages/domain/order-fields.mjs");
const {date}=require("./financial-calendar");
// A bounded exhaustive search minimizes the distance of the confirmed provider routes.
// Scheduled times remain untouched, and no route is returned if a required leg is unknown.
function optimize(matrix,n,returnBase){
 const evaluate=sequence=>{
   let from=0,meters=0,seconds=0;const legs=[];
   for(const to of [...sequence,...(returnBase?[0]:[])]){
     const leg=matrix[from]?.[to];if(!leg||leg.state!=="confirmed")return null;
     meters+=leg.distance_meters;seconds+=leg.duration_seconds;
     legs.push({from,to,distance_meters:leg.distance_meters,duration_seconds:leg.duration_seconds,...(leg.provider?{provider:leg.provider}:{})});from=to;
   }
   return {sequence,meters,seconds,legs};
 };
 const scheduled=evaluate(Array.from({length:n},(_,i)=>i+1));let best=scheduled;
 function visit(seq,left){
   if(!left.length){const v=evaluate(seq);if(v&&(!best||v.meters<best.meters||v.meters===best.meters&&v.seconds<best.seconds))best=v;return;}
   for(const i of left)visit([...seq,i],left.filter(x=>x!==i));
 }
 visit([],Array.from({length:n},(_,i)=>i+1));
 return {scheduled,best};
}
function address(o){
 const doc=o.document_data||{},prefix=doc.service_address_same===false?"service":"customer";
 if(doc.service_address_same===undefined&&o.location&&o.location!==doc.customer_address)return "";
 if(!["street","number","city","state"].every(k=>String(doc[prefix+"_"+k]||"").trim()))return "";
 return formatAddress(doc,prefix)+", Brasil";
}
// At most 30 directed leg requests per explicit calculation, 1 per technician per minute.
const recent=new Map(),pending=new Set();
async function dailyRoute(pool,cfg,t,input,{route=roadRoute,now=Date.now}={}){
 const day=date(input?.day),returnBase=input?.return_to_base===true;
 if(day<d.today())fail(400,"Escolha hoje ou uma data futura.");
 const rows=await d.rows(pool,"SELECT id,service,vehicle,scheduled_at,location,document_data,created_by,customer_name,sga_id,parent_order_id FROM zc_orders WHERE technician_id=$1 AND deleted_at='' AND parent_order_id IS NULL AND workflow_mode='controlled' AND status='AGENDADO' AND substring(scheduled_at,1,10)=$2 ORDER BY scheduled_at,id",[t.id,day]);
 const stops=rows.map((o,i)=>({index:i+1,id:o.id,service:o.service,vehicle:o.vehicle,scheduled_at:o.scheduled_at,address:address(o)}));
 const base={day,return_to_base:returnBase,stops:stops.map(({address,...s})=>s),checked_at:new Date().toISOString()};
 if(!stops.length)return {...base,state:"empty"};
 if(stops.length>5)return {...base,state:"limit"};
 const routing=require("./routing-providers");
 const scope=require("./demo-routing-scope");
 const allowExternal=scope.demoOrigin(cfg,t)&&rows.every(o=>scope.demoDestination(cfg,o,address(o)));
 const providers=routing.configuredProviders(cfg,allowExternal);
 if(!providers.length)return {...base,state:"not_configured"};
 if(!t.address?.trim())return {...base,state:"missing_origin"};
 if(stops.some(s=>!s.address))return {...base,state:"address_review",invalid_ids:stops.filter(s=>!s.address).map(s=>s.id)};
 const stamp=now();
 for(const [id,time] of recent)if(stamp-time>=60000)recent.delete(id);
 if(pending.has(t.id)||recent.has(t.id))fail(429,"Aguarde um minuto antes de calcular outra rota.");
 recent.set(t.id,stamp);pending.add(t.id);
 try{
  const points=[t.address.trim(),...stops.map(s=>s.address)],matrix=points.map(()=>[]),pairs=[];
  for(let i=0;i<points.length;i++)for(let j=0;j<points.length;j++)if(i!==j&&(j!==0||returnBase))pairs.push([i,j]);
  const routes=route===roadRoute?await routing.calculateBatch(cfg,points,pairs,{allowExternal,googleRoute:roadRoute}):await Promise.all(pairs.map(async([i,j])=>{try{return await route(cfg.GOOGLE_ROUTES_API_KEY,points[i],points[j]);}catch{return {state:"unavailable"};}}));
  pairs.forEach(([i,j],index)=>{matrix[i][j]=routes[index]});
  const usedProviders=[...new Set(routes.filter(r=>r.state==="confirmed").map(r=>r.provider).filter(Boolean))];
  if(pairs.some(([i,j])=>matrix[i][j]?.state!=="confirmed"))return {...base,state:"route_unavailable",providers,route_issues:routes.filter(r=>r.state!=="confirmed").map(r=>({provider:r.provider,state:r.state,reason:r.reason}))};
  const result=optimize(matrix,stops.length,returnBase);
  if(!result.scheduled||!result.best)return {...base,state:"route_unavailable"};
  return {...base,state:"ready",providers:usedProviders,...result,saved_meters:result.scheduled.meters-result.best.meters,changes_order:result.best.sequence.some((n,i)=>n!==i+1)};
 }finally{pending.delete(t.id)}
}
module.exports={optimize,dailyRoute,address};
