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
test("ordena por distância rodoviária somente com estoque e rota confirmados",()=>{
 const rows=rank([{name:"Sem estoque",stock_state:"insufficient",route:{state:"confirmed",duration_seconds:60,distance_meters:100}},{name:"A",stock_state:"sufficient",route:{state:"confirmed",duration_seconds:900,distance_meters:10000}},{name:"B",stock_state:"sufficient",route:{state:"confirmed",duration_seconds:600,distance_meters:15000}},{name:"C",stock_state:"unknown",route:{state:"unavailable"}}]);
 assert.deepEqual(rows.slice(0,2).map(x=>x.name),["A","B"]);
 assert.equal(rows.filter(x=>x.recommended).length,2);
});
test("rota usa DRIVE e rejeita endereço parcial, sem fabricar distância",async()=>{
 const exact={placeId:"test",type:["street_address"]};
 const request=async(url,opts)=>{assert.equal(JSON.parse(opts.body).travelMode,"DRIVE");assert.equal(opts.headers["X-Goog-Api-Key"],"test");return {ok:true,json:async()=>({routes:[{distanceMeters:12000,duration:"900s"}],geocodingResults:{origin:exact,destination:exact}})}};
 assert.deepEqual(await roadRoute("test","Base fictícia","Destino fictício",request),{state:"confirmed",distance_meters:12000,duration_seconds:900});
 const partial=async()=>({ok:true,json:async()=>({routes:[{distanceMeters:12000,duration:"900s"}],geocodingResults:{origin:exact,destination:{...exact,partialMatch:true}}})});
 assert.deepEqual(await roadRoute("test","Base fictícia","Destino fictício",partial),{state:"address_review",address_issue:{origin:false,destination:true}});
});

test("desempate usa duração somente se a distância de automóvel é igual",()=>{
 const rows=rank([{name:"Longo",stock_state:"sufficient",route:{state:"confirmed",distance_meters:15000,duration_seconds:90}},{name:"Lento",stock_state:"sufficient",route:{state:"confirmed",distance_meters:10000,duration_seconds:900}},{name:"Rápido",stock_state:"sufficient",route:{state:"confirmed",distance_meters:10000,duration_seconds:600}},{name:"Sem estoque",stock_state:"insufficient",route:{state:"confirmed",distance_meters:50,duration_seconds:5}}]);
 assert.deepEqual(rows.map(x=>x.name),["Rápido","Lento","Longo","Sem estoque"]);
});

test("proximidade geográfica permanece visível mesmo com estoque insuficiente",async()=>{
 const {recommend}=require("../src/technician-recommendations");
 const techs=[{id:10,name:"Duque de Caxias",address:"Base Caxias",stock_technician_id:10},{id:3,name:"Nova Iguaçu",address:"Base Iguaçu",stock_technician_id:3}];
 const db={query:async(sql)=>({rows:sql.includes("FROM zc_technicians t")?techs:[]})};
 const stock={items:async(id)=>({items:[{codigo_serial:"r"+id,status:"TECNICO",categoria:"RASTREADOR"},...(id===3?[{codigo_serial:"t3",status:"TECNICO",categoria:"TAG"}]:[])]})};
 const called=[];
 const result=await recommend(db,{GOOGLE_ROUTES_API_KEY:"teste"},{required:{RASTREADOR:1,TAG:1,PERFURADO:0},address:{street:"Rua teste",number:"10",city:"Duque de Caxias",state:"RJ"}},{stock,route:async(key,origin)=>{called.push(origin);return {state:"confirmed",distance_meters:origin.includes("Caxias")?1000:12000,duration_seconds:600}}});
 assert.equal(called.length,2);
 assert.equal(result.items[0].id,3);assert.equal(result.items[0].recommended,true);
 const nearby=result.items[1];assert.equal(nearby.id,10);assert.equal(nearby.nearest_geographic,true);assert.equal(nearby.recommended,false);assert.equal(nearby.route.distance_meters,1000);assert.deepEqual(nearby.shortages,[{equipment:"TAG",missing:1}]);
});
test("rota de zero metros aceita omissão do escalar somente com confirmação do mesmo local",async()=>{
 const exact={placeId:"same",type:["street_address"]};
 const request=async()=>({ok:true,json:async()=>({routes:[{duration:"0s"}],geocodingResults:{origin:exact,destination:exact}})});
 assert.deepEqual(await roadRoute("key","Base","Destino",request),{state:"confirmed",distance_meters:0,duration_seconds:0});
 const different=async()=>({ok:true,json:async()=>({routes:[{duration:"0s"}],geocodingResults:{origin:exact,destination:{...exact,placeId:"other"}}})});
 assert.deepEqual(await roadRoute("key","Base","Destino",different),{state:"unavailable",reason:"invalid_route_metrics"});
});

test("mesmo ponto exato e endereços iguais não exigem deslocamento, inclusive sem rota retornada",async()=>{
 const exact={placeId:"same",type:["street_address"]};
 const request=async()=>({ok:true,json:async()=>({geocodingResults:{origin:exact,destination:exact}})});
 const result=await roadRoute("key","Alameda Esmeralda, 206 - Jardim Primavera - Duque de Caxias / RJ","Alameda Esmeralda, 206, Jardim Primavera, Duque de Caxias, RJ, Brasil",request);
 assert.deepEqual(result,{state:"confirmed",distance_meters:0,duration_seconds:0,basis:"same_confirmed_point"});
});
test("fallback utiliza os IDs exatos de ambos endereços de Caxias e mantém ranking por distância",async()=>{
 const origin={placeId:"base-id",type:["premise"]},destination={placeId:"client-id",type:["street_address"]};
 let calls=0;
 const request=async(url,opts)=>{
  const body=JSON.parse(opts.body);
  calls++;
  if(calls===1){assert.equal(body.origin.address,"Alameda Esmeralda, 206, Jardim Primavera, Duque de Caxias, RJ, Brasil");return {ok:true,json:async()=>({geocodingResults:{origin,destination}})};}
  assert.deepEqual(body.origin,{placeId:"base-id"});assert.deepEqual(body.destination,{placeId:"client-id"});
  return {ok:true,json:async()=>({routes:[{distanceMeters:11400,duration:"1500s"}]})};
 };
 const route=await roadRoute("key","Alameda Esmeralda, 206 - Jardim Primavera - Duque de Caxias / RJ","Praça Roberto da Silveira, 31 - Jardim 25 de Agosto - Duque de Caxias / RJ",request);
 assert.equal(calls,2);
 assert.deepEqual(route,{state:"confirmed",distance_meters:11400,duration_seconds:1500,basis:"resolved_place_ids"});
 assert.equal(rank([{id:1,name:"Caxias",route,stock_state:"sufficient"},{id:2,name:"Longe",route:{state:"confirmed",distance_meters:19000,duration_seconds:1100},stock_state:"sufficient"}])[0].id,1);
});
test("distingue autorização, cota e falha temporária sem expor resposta bruta ou inventar rota",async()=>{
 for(const [status,reason] of [[403,"authorization"],[429,"quota"],[400,"invalid_request"]]){
  let calls=0;
  const result=await roadRoute("key","Base","Destino",async()=>{calls++;return {ok:false,status}});
  assert.deepEqual(result,{state:"unavailable",reason,http_status:status});assert.equal(calls,1);
 }
 let calls=0;
 const exact={placeId:"point",type:["street_address"]};
 const result=await roadRoute("key","Base","Destino",async()=>++calls===1?{ok:false,status:503}:{ok:true,json:async()=>({routes:[{distanceMeters:500,duration:"60s"}],geocodingResults:{origin:exact,destination:{...exact,placeId:"other"}}})});
 assert.equal(calls,2);assert.equal(result.distance_meters,500);
});
