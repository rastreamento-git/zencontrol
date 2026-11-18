const {test}=require("node:test"),assert=require("node:assert/strict");
const {configuredProviders,calculateBatch}=require("../src/routing-providers");
const points=["Alameda Esmeralda, 206 - Jardim Primavera - Duque de Caxias / RJ","Praça Roberto da Silveira, 31 - Jardim 25 de Agosto - Duque de Caxias / RJ","Rua Antônio Wilman, 230 - Centro - Nova Iguaçu / RJ"];
const feature=(street,number,city,coords)=>({geometry:{coordinates:coords},properties:{layer:"address",match_type:"exact",accuracy:"point",confidence:1,housenumber:number,street,locality:city,region_a:"RJ"}});
const orsFeatures=[feature("Alameda Esmeralda","206","Duque de Caxias",[-43.3,-22.6]),feature("Praça Roberto da Silveira","31","Duque de Caxias",[-43.31,-22.61]),feature("Rua Antônio Wilman","230","Nova Iguaçu",[-43.4,-22.75])];
const mapFeature=(i)=>{const source=orsFeatures[i];return {geometry:source.geometry,properties:{feature_type:"address",coordinates:{accuracy:"rooftop"},match_code:{confidence:"exact",address_number:"matched",street:"matched"},context:{place:{name:source.properties.locality},region:{region_code:"RJ"}}}}};
const ok=data=>({ok:true,json:async()=>data});
test("novos provedores só são habilitados para a simulação autorizada",()=>{
 const cfg={ORS_API_KEY:"ors",MAPBOX_ACCESS_TOKEN:"mb",GOOGLE_ROUTES_API_KEY:"g"};
 assert.deepEqual(configuredProviders(cfg,true),["ors","mapbox","google"]);
 assert.deepEqual(configuredProviders(cfg,false),["google"]);
 assert.deepEqual(configuredProviders({...cfg,ROUTING_PROVIDER_ORDER:"mapbox,ors"},true),["mapbox","ors"]);
});
test("ORS usa novos endpoints e matriz por automóvel, sem reenviar o destino por técnico",async()=>{
 const calls=[];
 const request=async(url,opts)=>{
  const u=new URL(url);calls.push(u.pathname);
  assert.equal(u.hostname,"api.heigit.org");assert.equal(opts.headers.Authorization,"ors");
  if(u.pathname==="/pelias/v1/search"){const q=u.searchParams.get("text");return ok({features:[orsFeatures.find(f=>q.includes(f.properties.street))]});}
  assert.equal(u.pathname,"/openrouteservice/v2/matrix/driving-car");
  const body=JSON.parse(opts.body);assert.equal(body.units,"m");assert.deepEqual(body.metrics,["distance","duration"]);
  return ok({distances:[[5000],[20000]],durations:[[800],[1200]]});
 };
 const result=await calculateBatch({ORS_API_KEY:"ors"},points,[[0,1],[2,1]],{allowExternal:true,request});
 assert.equal(calls.filter(s=>s.includes("search")).length,3);
 assert.equal(calls.filter(s=>s.includes("matrix")).length,1);
 assert.deepEqual(result.map(r=>[r.provider,r.distance_meters]),[["ors",5000],["ors",20000]]);
});
test("resultado ausente no ORS cai no Mapbox com geocodificação própria e Directions para um par",async()=>{
 const request=async(url,opts)=>{
  const u=new URL(url);
  if(u.hostname==="api.heigit.org"){
   if(u.pathname.includes("search")){const q=u.searchParams.get("text");return ok({features:[orsFeatures.find(f=>q.includes(f.properties.street))]});}
   return ok({distances:[[null],[20000]],durations:[[null],[1200]]});
  }
  assert.equal(u.hostname,"api.mapbox.com");
  if(u.pathname.includes("geocode")){assert.equal(u.searchParams.get("permanent"),"false");return ok({features:[mapFeature(u.searchParams.get("address_number")==="206"?0:1)]});}
  assert.match(u.pathname,/directions\/v5\/mapbox\/driving/);
  return ok({routes:[{distance:4000,duration:600}]});
 };
 const result=await calculateBatch({ORS_API_KEY:"ors",MAPBOX_ACCESS_TOKEN:"mb"},points,[[0,1],[2,1]],{allowExternal:true,request});
 assert.equal(result[0].provider,"mapbox");assert.equal(result[0].distance_meters,4000);
 assert.deepEqual(result[0].attempts.map(a=>a.provider),["ors","mapbox"]);assert.equal(result[1].provider,"ors");
});
test("não utiliza resultado de município ou geocodificação sem número confirmado",async()=>{
 const request=async()=>ok({features:[{...orsFeatures[0],properties:{...orsFeatures[0].properties,layer:"locality"}}]});
 const [r]=await calculateBatch({ORS_API_KEY:"ors"},points,[[0,1]],{allowExternal:true,request});
 assert.equal(r.state,"address_review");assert.equal(r.distance_meters,undefined);
});
test("Google permanece alternativa e não é chamado para consultar endereços via ORS em OS real",async()=>{
 const [r]=await calculateBatch({ORS_API_KEY:"ors",GOOGLE_ROUTES_API_KEY:"g"},points,[[0,1]],{request:async()=>{throw Error("não deveria chamar")},googleRoute:async()=>({state:"confirmed",distance_meters:1234,duration_seconds:300})});
 assert.equal(r.provider,"google");assert.equal(r.distance_meters,1234);
});
