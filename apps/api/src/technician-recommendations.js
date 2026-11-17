const d=require("./domain");
const {fail}=require("./errors");
const {StockClient}=require("./stock-client");
const {requiredEquipment,reused}=require("./equipment-plan");
const {formatAddress}=require("../../../packages/domain/order-fields.mjs");
const keys=["RASTREADOR","TAG","PERFURADO"];
const empty=()=>Object.fromEntries(keys.map(k=>[k,0]));
function requirements(order){
 const out={...empty(),...requiredEquipment(order)};
 if(reused(order)){out.RASTREADOR=0;out.TAG=0;}
 if(!order.parent_order_id&&!order.tracker_waiver_authorized&&order.sticker_discount_opt_in&&order.document_data?.visit_outcome!=="unproductive"&&order.document_data?.visit_outcome!=="reschedule"&&/^(Instalação|Reinstalação)/.test(order.service))out.PERFURADO=1;
 return out;
}
function validateInput(input){
 const n=input?.required;
 if(!n||keys.some(k=>!Number.isSafeInteger(n[k])||n[k]<0||n[k]>20)||n.RASTREADOR+n.TAG>20||n.PERFURADO>1)fail(400,"Informe as quantidades de equipamentos do atendimento.");
 const doc=input.address;
 if(!doc||typeof doc!=="object")fail(400,"Informe o endereço de instalação.");
 const address={};
 for(const k of ["street","number","neighborhood","city","state"]){address["customer_"+k]=d.string(doc[k]||"",k,150);}
 if(!address.customer_street||!address.customer_number||!address.customer_city||!/^[A-Z]{2}$/.test(address.customer_state))fail(400,"Complete rua, número, município e UF do endereço do atendimento.");
 return {required:n,destination:formatAddress(address)+", Brasil",orderId:d.string(input.order_id||"","OS",120)};
}
function inventory(load,orders,batches,excludeId){
 if(!Array.isArray(load?.items))throw Error("Estoque sem confirmação");
 const actual=empty(),used=empty(),serials=new Map(),group=new Map(),seen=new Set();
 for(const item of load.items){
   if(item.status!=="TECNICO"||!["RASTREADOR","TAG"].includes(item.categoria)||!item.codigo_serial||serials.has(item.codigo_serial))continue;
   serials.set(item.codigo_serial,item.categoria);actual[item.categoria]++;
 }
 const sticker=load.consumables?.find(x=>String(x.sga_product_code)==="2371");
 const stickerKnown=Number.isSafeInteger(sticker?.quantity)&&sticker.quantity>=0;
 if(stickerKnown)actual.PERFURADO=sticker.quantity;
 const excluded=order=>excludeId&&(order.id===excludeId||order.parent_order_id===excludeId);
 const roots=new Map(orders.map(o=>[o.id,o]));
 for(const o of orders){
   if(excluded(o)||o.stock_sync_state==="confirmed"||o.document_data?.visit_outcome==="reschedule")continue;
   const parent=roots.get(o.parent_order_id);
   if(parent?.document_data?.equipment_counts)continue;
   const need=requirements(o),id=o.parent_order_id||o.id;
   const g=group.get(id)||{need:empty(),reserved:empty()};
   for(const k of keys)g.need[k]+=need[k];
   group.set(id,g);
 }
 for(const b of batches){
   const order=roots.get(b.order_id);
   if(b.order_id===excludeId||order&&excluded(order))continue;
   const id=order?.parent_order_id||b.order_id;
   const g=group.get(id)||{need:empty(),reserved:empty()};
   for(const serial of Array.isArray(b.imeis)?b.imeis:[]){
     if(seen.has(serial)||!serials.has(serial))continue;
     seen.add(serial);g.reserved[serials.get(serial)]++;
   }
   group.set(id,g);
 }
 for(const g of group.values())for(const k of keys)used[k]+=Math.max(g.need[k],g.reserved[k]);
 return {actual,committed:used,free:Object.fromEntries(keys.map(k=>[k,k==="PERFURADO"&&!stickerKnown?null:Math.max(0,actual[k]-used[k])]))};
}
function stockState(stock,required){
 if(!keys.some(k=>required[k]>0))return "not_required";
 if(!stock||keys.some(k=>required[k]>0&&stock.free[k]===null))return "unknown";
 return keys.some(k=>stock.free[k]<required[k])?"insufficient":"sufficient";
}
async function roadRoute(key,origin,destination,request=fetch){
 const response=await request("https://routes.googleapis.com/directions/v2:computeRoutes",{
 method:"POST",headers:{"Content-Type":"application/json","X-Goog-Api-Key":key,"X-Goog-FieldMask":"routes.distanceMeters,routes.duration,geocodingResults.origin,geocodingResults.destination"},
 body:JSON.stringify({origin:{address:origin.replace(/,\s*Brasil$/i,"")+", Brasil"},destination:{address:destination},travelMode:"DRIVE",routingPreference:"TRAFFIC_UNAWARE",regionCode:"BR",languageCode:"pt-BR",units:"METRIC"}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error("Rota indisponível");
 const data=await response.json(),route=data.routes?.[0],geo=data.geocodingResults;
 const precise=w=>w?.placeId&&w.partialMatch!==true&&!(w.geocoderStatus?.code)&&Array.isArray(w.type)&&w.type.some(x=>["street_address","premise","subpremise","establishment","point_of_interest"].includes(x));
 if(!precise(geo?.origin)||!precise(geo?.destination))return {state:"address_review"};
 if(!route||!Number.isSafeInteger(route.distanceMeters)||route.distanceMeters<0||!/^\d+(?:\.\d+)?s$/.test(route.duration||""))return {state:"unavailable"};
 return {state:"confirmed",distance_meters:route.distanceMeters,duration_seconds:Number(route.duration.slice(0,-1))};
}
function rank(items){
 const eligible=x=>["sufficient","not_required"].includes(x.stock_state)&&x.route.state==="confirmed";
 return [...items].sort((a,b)=>Number(eligible(b))-Number(eligible(a))||(eligible(a)&&eligible(b)?a.route.duration_seconds-b.route.duration_seconds||a.route.distance_meters-b.route.distance_meters:0)||a.name.localeCompare(b.name,"pt-BR")).map(x=>({...x,recommended:eligible(x)}));
}
async function mapLimit(items,limit,fn){
 const result=new Array(items.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(items.length,limit)},async()=>{while(cursor<items.length){const i=cursor++;result[i]=await fn(items[i]);}}));
 return result;
}
async function recommend(pool,cfg,input,{stock=new StockClient(cfg),route=roadRoute}={}){
 const {required,destination,orderId}=validateInput(input);
 if(orderId){const order=await d.one(pool,"SELECT id,parent_order_id,status FROM zc_orders WHERE id=$1 AND deleted_at='' ",[orderId]);if(!order||order.parent_order_id||["CONCLUÍDO","CANCELADO"].includes(order.status))fail(400,"Recomendações disponíveis apenas para OS principais em aberto.");}
 const technicians=await d.rows(pool,"SELECT t.id,t.name,t.address,t.stock_technician_id,r.travel_km_cents,r.travel_policy FROM zc_technicians t LEFT JOIN LATERAL (SELECT travel_km_cents,travel_policy FROM zc_rates WHERE technician_id=t.id AND effective_on<=$1 ORDER BY effective_on DESC LIMIT 1) r ON true WHERE t.active=true ORDER BY t.name,t.id",[d.today()]);
 if(technicians.length>100)fail(409,"Mais de 100 técnicos ativos. Divida a consulta por região antes de calcular as rotas.");
 const ids=technicians.map(t=>t.id);
 const orders=await d.rows(pool,"SELECT id,parent_order_id,technician_id,service,status,document_data,tracker_waiver_authorized,sticker_discount_opt_in,stock_sync_state FROM zc_orders WHERE technician_id=ANY($1::int[]) AND deleted_at='' AND status NOT IN ('CONCLUÍDO','CANCELADO')",[ids]);
 const batches=await d.rows(pool,"SELECT technician_id,order_id,imeis FROM zc_batches WHERE technician_id=ANY($1::int[]) AND source<>'bundle' AND state IN ('draft','submitted','approved_sync','stock_failed')",[ids]);
 const configured=Boolean(cfg.GOOGLE_ROUTES_API_KEY);
 const seenLinks=new Map();for(const t of technicians)if(t.stock_technician_id)seenLinks.set(t.stock_technician_id,(seenLinks.get(t.stock_technician_id)||0)+1);
 const rows=await mapLimit(technicians,8,async t=>{
   let available=null,stockNote="";
   if(keys.some(k=>required[k]>0)){
     if(!t.stock_technician_id)stockNote="Sem vínculo com Estoque Pro";
     else if(seenLinks.get(t.stock_technician_id)>1)stockNote="Vínculo de estoque compartilhado; confira o cadastro";
     else try{available=inventory(await stock.items(t.stock_technician_id),orders.filter(o=>o.technician_id===t.id),batches.filter(b=>b.technician_id===t.id),orderId)}catch{stockNote="Não foi possível confirmar o estoque";}
   }
   const stock_state=stockState(available,required);
   let journey={state:!configured?"not_configured":!t.address?.trim()?"missing_origin":"not_checked"};
   if(configured&&t.address?.trim()&&["sufficient","not_required"].includes(stock_state)){
      try{journey=await route(cfg.GOOGLE_ROUTES_API_KEY,t.address.trim(),destination)}catch{journey={state:"unavailable"}}
   }
   let travel_estimate=null;
   if(journey.state==="confirmed")try{travel_estimate=require("./travel-policy").estimate(journey.distance_meters,t)}catch{}
   return {id:t.id,name:t.name,stock:available,stock_state,stock_note:stockNote,route:journey,travel_estimate};
 });
 return {items:rank(rows),required,routing_configured:configured,checked_at:new Date().toISOString(),travel_mode:"DRIVE",traffic:"not_considered"};
}
module.exports={requirements,validateInput,inventory,stockState,roadRoute,rank,recommend};
