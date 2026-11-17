const {test}=require("node:test"),assert=require("node:assert/strict");
const {optimize,address}=require("../src/daily-route");
const {estimate}=require("../src/travel-policy");
const {travelCharge}=require("../src/finance-engine");
test("cobertura e cobrança por km sem modificar a regra antiga",()=>{
 const rate={travel_km_cents:250,travel_policy:{mode:"excess",included_meters:20000}};
 assert.deepEqual(estimate(45000,rate),{state:"charged",billable_meters:25000,amount_cents:6250});
 assert.equal(estimate(20000,rate).amount_cents,0);
 assert.equal(estimate(45000,{...rate,travel_policy:{mode:"full",included_meters:20000}}).amount_cents,11250);
 assert.equal(estimate(45000,{...rate,travel_policy:{mode:"none",included_meters:0}}).amount_cents,0);
 assert.equal(travelCharge({travel_extra_meters:45000},rate).amount_cents,11250);
 assert.equal(travelCharge({travel_total_meters:45000},rate).amount_cents,6250);
 assert.throws(()=>travelCharge({travel_total_meters:45000,travel_extra_meters:1000},rate));
 assert.equal(travelCharge({parent_order_id:"p",travel_total_meters:45000},rate),null);
});
test("ordena trajetos dirigidos por distância e preserva comparação agendada",()=>{
 const distances=[[0,20,5],[8,0,15],[7,4,0]];
 const matrix=distances.map(row=>row.map(distance_meters=>({state:"confirmed",distance_meters,duration_seconds:distance_meters})));
 const r=optimize(matrix,2,true);
 assert.deepEqual(r.scheduled.sequence,[1,2]);assert.equal(r.scheduled.meters,42);
 assert.deepEqual(r.best.sequence,[2,1]);assert.equal(r.best.meters,17);
 assert.equal(address({document_data:{customer_city:"Niterói",customer_state:"RJ"}}),"");
});

test("rota do técnico só consulta agenda própria e não envia endereços sem chave",async()=>{
 const {dailyRoute}=require("../src/daily-route"), d=require("../src/domain");
 let called=0;
 const db={query:async(sql,args)=>{assert.match(sql,/technician_id=\$1/);assert.deepEqual(args,[17,d.today()]);return {rows:[{id:"OS",vehicle:"ABC1A23",service:"Instalação",scheduled_at:d.today()+"T10:00",document_data:{customer_street:"Rua de teste",customer_number:"10",customer_city:"Niterói",customer_state:"RJ"}}]}}};
 const result=await dailyRoute(db,{}, {id:17,address:"Base fictícia"},{day:d.today(),return_to_base:true},{route:async()=>{called++;throw Error("não deve consultar")}});
 assert.equal(result.state,"not_configured");assert.equal(called,0);assert.equal(result.stops.length,1);assert.ok(!("address" in result.stops[0]));
});
test("acordo sem cobrança por km não aceita lançamento manual por distância",()=>{
 assert.throws(()=>travelCharge({travel_extra_meters:1000},{travel_km_cents:250,travel_policy:{mode:"none",included_meters:0}}));
});
