const {transaction}=require("./database");
const d=require("./domain");
const {fail}=require("./errors");
const {IntegrationError}=require("./integrations");

function regionalRows(payload,depth=0){
 if(Array.isArray(payload))return payload;
 if(!payload||typeof payload!=="object"||depth>5)throw Error("Formato inesperado na listagem de regionais SGA.");
 if(Object.hasOwn(payload,"codigo_regional"))return [payload];
 for(const key of ["regionais","items","dados","data","resultado","retorno"])
  if(Object.hasOwn(payload,key))return regionalRows(payload[key],depth+1);
 const entries=Object.entries(payload);
 if(entries.length&&entries.every(([key,value])=>/^\d+$/.test(key)&&value&&typeof value==="object"&&Object.hasOwn(value,"codigo_regional")))return entries.map(([,value])=>value);
 throw Error("Formato inesperado na listagem de regionais SGA.");
}
function normalizeRegional(row,expectedStatus=""){
 const code=String(row?.codigo_regional??"").trim();
 const name=[row?.descricao_regional,row?.nome_regional,row?.nome].find(v=>typeof v==="string"&&v.trim())?.trim().replace(/\s+/g," ")||"";
 const status=String(row?.situacao??"").trim().toUpperCase();
 if(!/^\d{1,20}$/.test(code)||!name||name.length>200)return null;
 return {code,name,status:["ATIVO","INATIVO"].includes(status)?status:expectedStatus};
}
async function fetchRows(client,filter){
 let payload;
 try{payload=await client.request("/listar/regional/"+filter,undefined,false);}
 catch(e){
  if(e.upstreamStatus===406&&e.noRecords)return [];
  console.warn(JSON.stringify({event:"sga_regionals_upstream_error",filter,status:e.upstreamStatus||null}));
  throw e;
 }
 try{return regionalRows(payload);}
 catch{
  console.warn(JSON.stringify({event:"sga_regionals_unrecognized_response",filter,kind:Array.isArray(payload)?"array":typeof payload}));
  throw new IntegrationError("O SGA retornou um formato de regionais não reconhecido. A lista anterior foi mantida.");
 }
}
async function collect(client){
 const all=await fetchRows(client,"todos");
 let batches=[{rows:all,expected:""}],source="todos";
 if(!all.length){
  source="ativo,inativo";
  batches=[{rows:await fetchRows(client,"ativo"),expected:"ATIVO"},{rows:await fetchRows(client,"inativo"),expected:"INATIVO"}];
 }
 const items=new Map(),conflicts=new Set();
 let invalid=0,duplicates=0,rawCount=0;
 for(const {rows,expected} of batches)for(const raw of rows){
  rawCount++;
  const item=normalizeRegional(raw,expected);
  if(!item){invalid++;continue;}
  if(expected&&item.status!==expected){invalid++;continue;}
  const previous=items.get(item.code);
  if(previous){duplicates++;if(previous.name!==item.name||previous.status!==item.status)conflicts.add(item.code);}
  else items.set(item.code,item);
 }
 const valid=[...items.values()].filter(item=>!conflicts.has(item.code));
 if(rawCount&&!valid.length)throw new IntegrationError("O SGA respondeu, mas nenhuma regional pôde ser identificada com código e nome válidos. A lista anterior foi mantida.");
 return {items:valid,skipped:invalid+conflicts.size,duplicates,source,raw_count:rawCount};
}
async function synchronize(pool,client,actor){
 if(!client.ready())fail(409,"Consulta SGA desativada ou incompleta.");
 const result=await collect(client);
 if(!result.items.length)fail(422,"O SGA não retornou regionais nos filtros Todos, Ativas e Inativas. Confira as permissões do usuário da integração. A lista anterior foi mantida.");
 return transaction(pool,async db=>{
  await db.query("LOCK TABLE zc_sga_regionals IN SHARE ROW EXCLUSIVE MODE");
  const local=await d.rows(db,"SELECT * FROM zc_sga_regionals");
  const existing=new Map(local.map(x=>[x.sga_code,x]));
  const summary={received:result.items.length,created:0,updated:0,unchanged:0,skipped:result.skipped,duplicates:result.duplicates,source:result.source,raw_count:result.raw_count};
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
