// All coordinates and provider results live only for the current calculation.
// No disk cache, personal identifiers, raw provider responses or tokens in logs.
let googleQuotaUntil=0;
const labels={ors:"OpenRouteService",mapbox:"Mapbox",google:"Google Maps"};
function configuredProviders(cfg,allowExternal=false){
 const available={ors:allowExternal&&cfg.ORS_API_KEY,mapbox:allowExternal&&cfg.MAPBOX_ACCESS_TOKEN,google:cfg.GOOGLE_ROUTES_API_KEY};
 const order=String(cfg.ROUTING_PROVIDER_ORDER||"ors,mapbox,google").split(",").map(s=>s.trim().toLowerCase());
 return [...new Set(order)].filter(k=>Object.hasOwn(available,k)&&Boolean(available[k]));
}
const unavailable=(reason,provider,http_status)=>({state:"unavailable",reason,provider,...(http_status?{http_status}:{})});
function addressParts(value){
 const s=String(value||"").trim().replace(/\s+-\s+/g,", ").replace(/\s+\/\s+/g,", ").replace(/,\s*Brasil\s*$/i,"");
 const parts=s.split(",").map(s=>s.trim()).filter(Boolean);
 const state=parts.pop(),city=parts.pop();
 const street=parts.shift(),number=parts.shift();
 if(!street||!number||!city||!state||!/^[A-Za-z]{2}$/.test(state)||! /^\d+[A-Za-z]?$/.test(number))return null;
 return {street,number,city,state:state.toUpperCase(),text:[street,number,...parts,city,state,"Brasil"].join(", ")};
}
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\b(avenida|av)\b/g,"av").replace(/\b(praca|pca|pc)\b/g,"praca").replace(/\b(doutor|dr)\b/g,"dr").replace(/\b(da|de|do|das|dos)\b/g,"").replace(/[^a-z0-9]/g,"");
const coordinates=f=>{const c=f?.geometry?.coordinates;return Array.isArray(c)&&c.length>=2&&Number.isFinite(c[0])&&Number.isFinite(c[1])&&c[0]>=-74&&c[0]<=-28&&c[1]>=-34&&c[1]<=6?c.slice(0,2):null};
const stateMatches=(value,state)=>[state,"BR-"+state,...(state==="RJ"?["Rio de Janeiro"]:[])].some(s=>norm(s)===norm(value));
async function json(request,url,opts,provider){
 try{
  const r=await request(url,{...opts,signal:AbortSignal.timeout(8000)});
  if(!r.ok)return {failure:unavailable(r.status===429?"quota":r.status===401||r.status===403?"authorization":r.status>=500?"provider_temporarily_unavailable":"provider_error",provider,r.status)};
  return {data:await r.json()};
 }catch(e){return {failure:unavailable(["TimeoutError","AbortError"].includes(e?.name)?"timeout":"network_or_response",provider)};}
}
function exactOrs(feature,p){
 const v=feature?.properties||{};
 return v.layer==="address"&&v.match_type!=="fallback"&&v.accuracy==="point"&&Number(v.confidence)>=0.8&&norm(v.housenumber)===norm(p.number)&&norm(v.street)===norm(p.street)&&[v.locality,v.localadmin,v.county].some(s=>norm(s)===norm(p.city))&&[v.region_a,v.region].some(s=>stateMatches(s,p.state))&&coordinates(feature);
}
function mapboxMatch(feature,p){
 const v=feature?.properties||{},m=v.match_code||{},c=v.context||{},accuracy=v.coordinates?.accuracy;
 const interpolated=accuracy==="interpolated"&&["matched","plausible"].includes(m.address_number);
 const exact=["rooftop","parcel","point"].includes(accuracy)&&m.address_number==="matched";
 if(v.feature_type!=="address"||!["exact","high","medium"].includes(m.confidence)||m.street!=="matched"||(!exact&&!interpolated))return null;
 if(![c.place?.name,c.locality?.name,c.district?.name].some(s=>norm(s)===norm(p.city))||![c.region?.region_code,c.region?.region_code_full,c.region?.name].some(s=>stateMatches(s,p.state)))return null;
 if(c.address?.address_number&&norm(c.address.address_number)!==norm(p.number))return null;
 if(c.country?.country_code&&c.country.country_code.toUpperCase()!=="BR")return null;
 const point=coordinates(feature);
 if(!point)return null;
 return {point,accuracy:interpolated?"interpolated":"exact"};
}
function exactMapbox(feature,p){const hit=mapboxMatch(feature,p);return hit?.accuracy==="exact"?hit.point:null;}
async function geocode(cfg,provider,value,request){
 const p=addressParts(value);
 if(!p)return {failure:{state:"address_review",provider,reason:"address_format"}};
 let r;
 if(provider==="ors"){
  const url=new URL("https://api.heigit.org/pelias/v1/search");
  url.search=new URLSearchParams({text:p.text,"boundary.country":"BRA",layers:"address",size:"5"}).toString();
  r=await json(request,url.toString(),{headers:{Authorization:cfg.ORS_API_KEY}},provider);
 }else{
  const url=new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.search=new URLSearchParams({address_number:p.number,street:p.street,place:p.city,region:p.state==="RJ"?"Rio de Janeiro":p.state,country:"BR",types:"address",autocomplete:"false",permanent:"false",limit:"5",language:"pt",access_token:cfg.MAPBOX_ACCESS_TOKEN}).toString();
  r=await json(request,url.toString(),{},provider);
 }
 if(r.failure)return r;
 const select=data=>{
  const matches=(Array.isArray(data?.features)?data.features:[]).map(f=>{
   if(provider==="mapbox")return mapboxMatch(f,p);
   const point=exactOrs(f,p);return point?{point,accuracy:"exact"}:null;
  }).filter(Boolean);
  const exact=matches.filter(m=>m.accuracy==="exact"),found=exact.length?exact:matches;
  if(!found.length||found.some(c=>c.point[0]!==found[0].point[0]||c.point[1]!==found[0].point[1]))return null;
  return found[0];
 };
 let found=select(r.data);
 // One alternative query format; keep address number, municipality and UF
 // validation unchanged. Only the already authorized demo addresses reach here.
 if(!found&&provider==="mapbox"){
  const url=new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.search=new URLSearchParams({q:p.text,country:"BR",types:"address",autocomplete:"false",permanent:"false",limit:"5",language:"pt",access_token:cfg.MAPBOX_ACCESS_TOKEN}).toString();
  r=await json(request,url.toString(),{},provider);
  if(r.failure)return r;
  found=select(r.data);
 }
 return found||{failure:{state:"address_review",provider,reason:"geocode_unconfirmed"}};
}
function metrics(provider,distance,duration){
 if(typeof distance!=="number"||typeof duration!=="number"||!Number.isFinite(distance)||!Number.isFinite(duration)||distance<0||duration<0)return unavailable("no_driving_route",provider);
 return {state:"confirmed",provider,distance_meters:Math.round(distance),duration_seconds:duration};
}
async function matrix(cfg,provider,coords,sources,destinations,request){
 let r;
 if(provider==="ors"){
  r=await json(request,"https://api.heigit.org/openrouteservice/v2/matrix/driving-car",{method:"POST",headers:{Authorization:cfg.ORS_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({locations:coords,sources:sources.map(String),destinations:destinations.map(String),metrics:["distance","duration"],units:"m"})},provider);
 }else if(sources.length*destinations.length===1){
  const url=new URL("https://api.mapbox.com/directions/v5/mapbox/driving/"+[coords[sources[0]],coords[destinations[0]]].map(c=>c.join(",")).join(";"));
  url.search=new URLSearchParams({overview:"false",access_token:cfg.MAPBOX_ACCESS_TOKEN}).toString();
  r=await json(request,url.toString(),{},provider);
  if(r.failure)return r;
  const route=r.data?.routes?.[0];
  return {data:{distances:[[route?.distance??null]],durations:[[route?.duration??null]]}};
 }else{
  const url=new URL("https://api.mapbox.com/directions-matrix/v1/mapbox/driving/"+coords.map(c=>c.join(",")).join(";"));
  url.search=new URLSearchParams({sources:sources.join(";"),destinations:destinations.join(";"),annotations:"distance,duration",access_token:cfg.MAPBOX_ACCESS_TOKEN}).toString();
  r=await json(request,url.toString(),{},provider);
 }
 return r;
}
async function limited(items,concurrency,fn){
 const output=[];let cursor=0;
 await Promise.all(Array.from({length:Math.min(items.length,concurrency)},async()=>{while(cursor<items.length){const i=cursor++;output[i]=await fn(items[i]);}}));
 return output;
}
// pairs are indexes into points. A matrix batch is at most 25 unique locations.
// In dispatch a single destination is shared; in daily planning <=6 locations.
async function calculateBatch(cfg,points,pairs,{allowExternal=false,googleRoute,request=fetch}={}){
 const permitted=typeof allowExternal==="function"?allowExternal:()=>allowExternal===true;
 const order=configuredProviders(cfg,pairs.some(permitted));
 const results=new Map(),attempts=new Map(),key=([a,b])=>a+":"+b;
 let remaining=[...pairs];
 for(const provider of order){
  if(!remaining.length)break;
  const current=provider==="google"?remaining:remaining.filter(permitted);
  if(!current.length)continue;
  if(provider==="google"){
   // Stop issuing further Google calls as soon as the provider rejects the
   // quota. A short process-wide cooldown is not a cache of route results.
   const routes=await limited(current,2,async([a,b])=>{
    if(Date.now()<googleQuotaUntil)return unavailable("quota_cooldown",provider,429);
    try{
     const result={...await googleRoute(cfg.GOOGLE_ROUTES_API_KEY,points[a],points[b]),provider};
     if(result.http_status===429)googleQuotaUntil=Date.now()+60000;
     return result;
    }catch{return unavailable("network_or_response",provider);}
   });
   current.forEach((pair,i)=>record(pair,routes[i]));
  }else{
   // Resolve only addresses still required by this provider, once in this
   // calculation. Never reuse the coordinates across requests or providers.
   const ids=[...new Set(current.flat())],unique=[...new Set(ids.map(i=>points[i]))];
   const geos=await limited(unique,4,s=>geocode(cfg,provider,s,request));
   const lookup=new Map(unique.map((s,i)=>[s,geos[i]]));
   const good=[];
   for(const pair of current){
    const a=lookup.get(points[pair[0]]),b=lookup.get(points[pair[1]]);
    if(a?.point&&b?.point)good.push(pair);
    else{
     const f=[a?.failure,b?.failure].find(v=>v?.state==="unavailable");
     record(pair,f||{state:"address_review",provider,reason:"geocode_unconfirmed",address_issue:{origin:!a?.point,destination:!b?.point}});
    }
   }
   // Each group contains <=24 origins plus a shared destination, or the full
   // small daily matrix. No straight-line fallback_speed parameter.
   let pending=[...good];
   while(pending.length){
    const group=[],indexes=new Set();
    pending=pending.filter(pair=>{
     const next=new Set([...indexes,...pair]);
     if(next.size>25)return true;
     group.push(pair);pair.forEach(i=>indexes.add(i));return false;
    });
    const ids=[...indexes],sourceIds=[...new Set(group.map(p=>p[0]))],destIds=[...new Set(group.map(p=>p[1]))];
    const coords=ids.map(i=>lookup.get(points[i]).point);
    const result=await matrix(cfg,provider,coords,sourceIds.map(i=>ids.indexOf(i)),destIds.map(i=>ids.indexOf(i)),request);
    for(const pair of group){
     const i=sourceIds.indexOf(pair[0]),j=destIds.indexOf(pair[1]);
     const route=result.failure||metrics(provider,result.data?.distances?.[i]?.[j],result.data?.durations?.[i]?.[j]);
     if(route.state==="confirmed"){
      const origin=lookup.get(points[pair[0]]).accuracy,destination=lookup.get(points[pair[1]]).accuracy;
      route.location_accuracy={origin,destination};
     }
     record(pair,route);
    }
   }
  }
  remaining=remaining.filter(p=>results.get(key(p))?.state!=="confirmed");
 }
 function record(pair,result){
  const k=key(pair),history=attempts.get(k)||[];
  history.push({provider:result.provider,state:result.state,reason:result.reason,http_status:result.http_status,address_issue:result.address_issue});
  attempts.set(k,history);results.set(k,{...result,attempts:history.slice()});
 }
 return pairs.map(p=>results.get(key(p))||{state:"not_configured"});
}
module.exports={configuredProviders,calculateBatch,addressParts,exactOrs,exactMapbox,labels};
