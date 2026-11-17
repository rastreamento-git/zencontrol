const {test}=require("node:test");
const assert=require("node:assert/strict");
const {inventory,stockState,rank,roadRoute,requirements}=require("../src/technician-recommendations");
test("estima estoque livre sem contar duas vezes OS agrupada e serial reservado",()=>{
 const load={items:[{codigo_serial:"a",status:"TECNICO",categoria:"RASTREADOR"},{codigo_serial:"b",status:"TECNICO",categoria:"RASTREADOR"},{codigo_serial:"c",status:"TECNICO",categoria:"TAG"}],consumables:[{sga_product_code:"2371",quantity:2}]};
 const orders=[{id:"p",service:"Instalação",document_data:{equipment_counts:{tracker:1,tag:1}},sticker_discount_opt_in:true},{id:"child",parent_order_id:"p",service:"Instalação",document_data:{equipment_counts:{tracker:0,tag:1}}}];
 const batches=[{order_id:"p",imeis:["a"]}];
 const stock=inventory(load,orders,batches,"");
 assert.deepEqual(stock.free,{RASTREADOR:1,TAG:0,PERFURADO:1});
 assert.equal(stockState(stock,{RASTREADOR:1,TAG:1,PERFURADO:0}),"insufficient");
 assert.deepEqual(inventory(load,orders,batches,"p").free,{RASTREADOR:2,TAG:1,PERFURADO:2});
 assert.equal(stockState(null,{RASTREADOR:0,TAG:0,PERFURADO:0}),"not_required");
 assert.equal(requirements({...orders[0],document_data:{...orders[0].document_data,reinstallation:true,reuse_equipment:true}}).RASTREADOR,0);
});
test("ordena por tempo rodoviário somente com estoque e rota confirmados",()=>{
 const rows=rank([{name:"Sem estoque",stock_state:"insufficient",route:{state:"confirmed",duration_seconds:60,distance_meters:100}},{name:"A",stock_state:"sufficient",route:{state:"confirmed",duration_seconds:900,distance_meters:10000}},{name:"B",stock_state:"sufficient",route:{state:"confirmed",duration_seconds:600,distance_meters:15000}},{name:"C",stock_state:"unknown",route:{state:"unavailable"}}]);
 assert.deepEqual(rows.slice(0,2).map(x=>x.name),["B","A"]);
 assert.equal(rows.filter(x=>x.recommended).length,2);
});
test("rota usa DRIVE e rejeita endereço parcial, sem fabricar distância",async()=>{
 const exact={placeId:"test",type:["street_address"]};
 const request=async(url,opts)=>{assert.equal(JSON.parse(opts.body).travelMode,"DRIVE");assert.equal(opts.headers["X-Goog-Api-Key"],"test");return {ok:true,json:async()=>({routes:[{distanceMeters:12000,duration:"900s"}],geocodingResults:{origin:exact,destination:exact}})}};
 assert.deepEqual(await roadRoute("test","Base fictícia","Destino fictício",request),{state:"confirmed",distance_meters:12000,duration_seconds:900});
 const partial=async()=>({ok:true,json:async()=>({routes:[{distanceMeters:12000,duration:"900s"}],geocodingResults:{origin:exact,destination:{...exact,partialMatch:true}}})});
 assert.deepEqual(await roadRoute("test","Base fictícia","Destino fictício",partial),{state:"address_review"});
});
