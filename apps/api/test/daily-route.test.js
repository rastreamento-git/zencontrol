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
