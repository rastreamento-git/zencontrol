const {test}=require("node:test"),assert=require("node:assert/strict");
const {dataset}=require("../../../scripts/rj-demo-data.cjs");
const {filters}=require("../src/agenda-summary");
test("massa fictícia RJ tem dez bases, cinquenta clientes e vinte paradas no mesmo dia em quatro municípios",()=>{
 const {technicians,customers}=dataset();
 assert.equal(technicians.length,10);assert.equal(customers.length,50);
 assert.equal(new Set(technicians.map(t=>t.city)).size,10);
 assert.equal(new Set(customers.map(c=>c.vehicle)).size,50);
 assert.ok(customers.every(c=>c.address.customer_state==="RJ"&&c.name.includes("NÃO ATENDER")));
 const today=customers.filter(c=>c.day_offset===0);
 assert.equal(today.length,20);assert.equal(new Set(today.map(c=>c.technician_key)).size,4);
 assert.ok(today.every(c=>!c.approximate));
 assert.equal(new Set(customers.map(c=>JSON.stringify(c.address))).size,50);
 for(const t of technicians)assert.equal(customers.filter(c=>c.technician_key===t.key).length,5);
});
test("filtros da agenda são parametrizados e restringem a contagem a OS principais",()=>{
 const result=filters({agenda_from:"2026-11-17",agenda_to:"2026-11-20",technician_id:"3",service_type:"Instalação",status:"AGENDADO"});
 assert.deepEqual(result.args,["2026-11-17","2026-11-20",3,"Instalação","AGENDADO"]);
 assert.match(result.base,/parent_order_id IS NULL/);
 assert.throws(()=>filters({day:"2026-11-17",technician_id:"3 OR 1=1"}));
 assert.throws(()=>filters({agenda_from:"2026-11-20",agenda_to:"2026-11-17"}));
});
