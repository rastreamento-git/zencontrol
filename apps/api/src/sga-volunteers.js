const {transaction}=require("./database");
const d=require("./domain");
const {fail}=require("./errors");
const PAGE_SIZE=5000;
const MAX_PAGES=40;
const nameKey=s=>String(s).trim().replace(/\s+/g," ").normalize("NFC").toLocaleLowerCase("pt-BR");
function pageRows(payload,depth=0){
 if(Array.isArray(payload))return payload;
 if(!payload||typeof payload!=="object"||depth>5)throw Error("Formato inesperado na listagem SGA.");
 if(Object.hasOwn(payload,"codigo_voluntario"))return [payload];
 for(const key of ["voluntarios","items","dados","data","resultado","retorno"])
  if(Object.hasOwn(payload,key))return pageRows(payload[key],depth+1);
 throw Error("Formato inesperado na listagem SGA.");
}
function normalizeRow(row){
 const code=String(row?.codigo_voluntario??"").trim();
 const name=typeof row?.nome==="string"?row.nome.trim().replace(/\s+/g," "):"";
 const status=String(row?.situacao??"").trim().toUpperCase();
 if(!/^\d{1,20}$/.test(code)||!name||name.length>200)return null;
 return {code,name,status:["ATIVO","INATIVO"].includes(status)?status:""};
}
async function collect(client){
 const unique=new Map(),conflicts=new Set();
 let invalid=0,duplicates=0;
 for(let page=0;page<MAX_PAGES;page++){
  let response;
  try{response=await client.request("/listar/voluntario/todos/"+page,undefined,false);}
  catch(e){if(e.upstreamStatus===406&&e.noRecords)return {items:[...unique.values()].filter(x=>!conflicts.has(x.code)),invalid,duplicates,conflicts:conflicts.size,pages:page+1};throw e;}
  const rows=pageRows(response);
  if(rows.length>PAGE_SIZE)throw Error("SGA retornou mais registros que o limite da página.");
  let newCodes=0;
  for(const row of rows){
   const item=normalizeRow(row);
   if(!item){invalid++;continue;}
   const previous=unique.get(item.code);
   if(previous){duplicates++;if(previous.name!==item.name||previous.status!==item.status)conflicts.add(item.code);}
   else {unique.set(item.code,item);newCodes++;}
  }
  if(rows.length<PAGE_SIZE)return {items:[...unique.values()].filter(x=>!conflicts.has(x.code)),invalid,duplicates,conflicts:conflicts.size,pages:page+1};
  if(!newCodes)throw Error("A paginação do SGA repetiu uma página completa.");
 }
 throw Error("Limite de páginas atingido; nenhum registro foi alterado.");
}
async function synchronize(pool,client,actor){
 if(!client.ready())fail(409,"Consulta SGA desativada ou incompleta.");
 const received=await collect(client);
 return transaction(pool,async db=>{
  await db.query("LOCK TABLE zc_volunteers IN SHARE ROW EXCLUSIVE MODE");
  const local=await d.rows(db,"SELECT * FROM zc_volunteers ORDER BY id");
  const byCode=new Map(),byName=new Map();
  const add=(map,k,v)=>{if(k)map.set(k,[...(map.get(k)||[]),v]);};
  for(const v of local){add(byCode,v.sga_code,v);add(byName,nameKey(v.name),v);}
  const summary={received:received.items.length,created:0,updated:0,unchanged:0,linked:0,skipped:received.invalid+received.conflicts,duplicates:received.duplicates,pages:received.pages};
  const sourceNames=new Map();
  for(const item of received.items)add(sourceNames,nameKey(item.name),item);
  const stamp=new Date().toISOString();
  for(const item of received.items){
   if(sourceNames.get(nameKey(item.name)).length>1){summary.skipped++;continue;}
   const matches=byCode.get(item.code)||[],names=byName.get(nameKey(item.name))||[];
   if(matches.length>1){summary.skipped++;continue;}
   const existing=matches[0]||(names.length===1&&!names[0].sga_code?names[0]:null);
   if(names.some(n=>n.id!==existing?.id)){summary.skipped++;continue;}
   if(existing){
    const linked=!existing.sga_code;
    const changed=existing.name!==item.name||linked||existing.sga_status!==item.status;
    await db.query("UPDATE zc_volunteers SET name=$1,sga_code=$2,sga_status=$3,sga_synced_at=$4 WHERE id=$5",[item.name,item.code,item.status,stamp,existing.id]);
    if(linked)summary.linked++;else if(changed)summary.updated++;else summary.unchanged++;
    const oldKey=nameKey(existing.name);
    byName.set(oldKey,(byName.get(oldKey)||[]).filter(n=>n.id!==existing.id));
    Object.assign(existing,{name:item.name,sga_code:item.code,sga_status:item.status,sga_synced_at:stamp});
    if(linked)add(byCode,item.code,existing);
    add(byName,nameKey(item.name),existing);
   }else{
    const v=await d.one(db,"INSERT INTO zc_volunteers(name,sga_code,sga_status,sga_synced_at) VALUES($1,$2,$3,$4) RETURNING *",[item.name,item.code,item.status,stamp]);
    add(byName,nameKey(item.name),v);add(byCode,item.code,v);summary.created++;
   }
  }
  await d.audit(db,actor,"sga_volunteers_sync","volunteer","catalog",summary);
  return {...summary,synced_at:stamp};
 });
}
module.exports={collect,normalizeRow,pageRows,synchronize};
