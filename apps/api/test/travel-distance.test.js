const {test}=require("node:test");
const assert=require("node:assert/strict");
const {prices,travelCharge}=require("../src/finance-engine");
test("cinco serviços novos, compatibilidade com visita histórica",()=>{
 const p={"Instalação":8000,"Manutenção":6000,"Retirada":5000,"Reinstalação":9000,"Improdutiva":3500};
 assert.equal(prices(p).Visita,3500);
 assert.equal(prices({...p,Visita:100}).Visita,3500);
 assert.throws(()=>prices({...p,Improdutiva:-1}));
});
test("distância autorizada é remunerada uma vez com valor vigente em centavos",()=>{
 const rate={travel_km_cents:250};
 const travel=travelCharge({travel_extra_meters:20500},rate);
 assert.equal(travel.amount_cents,5125);
 assert.equal(travel.distance_meters,20500);
 assert.equal(travel.rate_cents_per_km,250);
 assert.equal(travelCharge({parent_order_id:"OS1",travel_extra_meters:20000},rate),null);
 assert.equal(travelCharge({travel_fee_cents:5000},rate).amount_cents,5000);
 assert.throws(()=>travelCharge({travel_extra_meters:1000,travel_fee_cents:500},rate));
 assert.throws(()=>travelCharge({travel_extra_meters:1000},{travel_km_cents:0}));
});
