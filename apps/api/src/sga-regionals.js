const {transaction}=require("./database");
const d=require("./domain");
const {fail}=require("./errors");

function regionalRows(payload,depth=0){
 if(Array.isArray(payload))return payload;
 if(!payload||typeof payload!=="object"||depth>5)throw Error("Formato inesperado na listagem de regionais SGA.");
 if(Object.hasOwn(payload,"codigo_regional"))return [payload];
 for(const key of ["regionais","items","dados","data","resultado","retorno"])
  if(Object.hasOwn(payload,key))return regionalRows(payload[key],depth+1);
 throw Error("Formato inesperado na listagem de regionais SGA.");
}
function normalizeRegional(row){
 const code=String(row?.codigo_regional??"").trim();
 const name=typeof row?.descricao_regional==="string"?row.descricao_regional.trim().replace(/\s+/g," "):"";
 const status=String(row?.situacao??"").trim().toUpperCase();
 if(!/^\d{1,20}$/.test(code)||!name||name.length>200)return null;
 return {code,name,status:["ATIVO","INATIVO"].includes(status)?status:""};
}
async function collect(client){
 let payload;
 try{payload=await client.request("/listar/regional/todos",undefined,false);}
 catch(e){if(e.upstreamStatus===406&&e.noRecords)payload=[];else throw e;}
 const items=new Map(),conflicts=new Set();
 let invalid=0,duplicates=0;
 for(const raw of regionalRows(payload)){
  const item=normalizeRegional(raw);
  if(!item){invalid++;continue;}
  const previous=items.get(item.code);
  if(previous){duplicates++;if(previous.name!==item.name||previous.status!==item.status)conflicts.add(item.code);}
  else items.set(item.code,item);
 }
 return {items:[...items.values()].filter(item=>!conflicts.has(item.code)),skipped:invalid+conflicts.size,duplicates};
}
async function synchronize(pool,client,actor){
 if(!client.ready())fail(409,"Consulta SGA desativada ou incompleta.");
 const result=await collect(client);
 return transaction(pool,async db=>{
  await db.query("LOCK TABLE zc_sga_regionals IN SHARE ROW EXCLUSIVE MODE");
  const local=await d.rows(db,"SELECT * FROM zc_sga_regionals");
  const existing=new Map(local.map(x=>[x.sga_code,x]));
  const summary={received:result.items.length,created:0,updated:0,unchanged:0,skipped:result.skipped,duplicates:result.duplicates};
  const stamp=new Date().toISOString();
  for(const item of result.items){
   const old=existing.get(item.code);
   if(!old)summary.created++;
   else if(old.name!==item.name||old.sga_status!==item.status)summary.updated++;
   else summary.unchanged++;
   await db.query("INSERT INTO zc_sga_regionals(sga_code,name,sga_status,sga_synced_at) VALUES($1,$2,$3,$4) ON CONFLICT(sga_code) DO UPDATE SET name=EXCLUDED.name,sga_status=EXCLUDED.sga_status,sga_synced_at=EXCLUDED.sga_synced_at",[item.code,item.name,item.status,stamp]);
  }
  await d.audit(db,actor,"sga_regionals_sync","regional","catalog",summary);
  return {...summary,synced_at:stamp};
 });
}
module.exports={regionalRows,normalizeRegional,collect,synchronize};
