const {dataset,groups,address}=require("./rj-demo-data.cjs");
const d=require("../apps/api/src/domain"),o=require("../apps/api/src/orders"),f=require("../apps/api/src/finance-engine"),cal=require("../apps/api/src/financial-calendar");
const {transaction}=require("../apps/api/src/database");
const {formatAddress}=require("../packages/domain/order-fields.mjs");
const {createTechnicianAccount}=require("../apps/api/src/technician-access");
const {actor,isDemoOrder}=require("../apps/api/src/demo-rj");
const marker="local-demo-rj-v1",resetMarker="local-demo-rj-unassigned-v2",demoCfg={DEMO_RJ_ISOLATED:true};
async function resetOriginalAssignments(pool){
 if(await d.one(pool,"SELECT 1 FROM zc_migration_runs WHERE fingerprint=$1",[resetMarker]))return;
 const {customers,technicians}=dataset();let released=0,skipped=0;
 for(const c of customers){
   const row=await d.one(pool,"SELECT * FROM zc_orders WHERE created_by=$1 AND customer_name=$2 AND vehicle=$3 AND parent_order_id IS NULL AND deleted_at='' ",[actor,c.name,c.vehicle]);
   if(!row||!row.technician_id)continue;
   const original=technicians.find(t=>t.key===c.technician_key);
   // Only reset untouched original fixtures; preserve anything already edited or executed.
   if(!isDemoOrder(demoCfg,row)||row.version!==1||row.status!=="AGENDADO"||row.technician_name!==original?.name||row.execution_finished_at||row.executed_on||row.completed_at){skipped++;continue;}
   const protectedRecord=await d.one(pool,`SELECT 1 FROM zc_orders member WHERE (member.id=$1 OR member.parent_order_id=$1) AND
     (member.version<>1 OR member.status<>'AGENDADO' OR EXISTS(SELECT 1 FROM zc_batches b WHERE b.order_id=member.id) OR EXISTS(SELECT 1 FROM zc_financial_ledger f WHERE f.order_id=member.id) OR EXISTS(SELECT 1 FROM zc_settlement_orders s WHERE s.order_id=member.id)) LIMIT 1`,[row.id]);
   if(protectedRecord){skipped++;continue;}
   await o.edit(pool,row.id,{version:row.version,technician_id:null,status:"PENDENTE"},actor,demoCfg);released++;
 }
 await pool.query("INSERT INTO zc_migration_runs(fingerprint,source,created_at,summary) VALUES($1,'local-fictional',$2,$3::jsonb)",[resetMarker,d.now(),JSON.stringify({released,skipped})]);
 console.log("Demonstração RJ: "+released+" atribuições originais liberadas; "+skipped+" registros já alterados preservados.");
}
async function seed({pool,stockPool,move,credentials,online,enabled}){
 if(!enabled)return;
 if(process.env.DATABASE_URL||process.env.TEST_DATABASE_URL)throw Error("A massa RJ é exclusiva da homologação isolada.");
 if(await d.one(pool,"SELECT 1 FROM zc_migration_runs WHERE fingerprint=$1",[marker])){await resetOriginalAssignments(pool);return;}
 const data=dataset(),techs=new Map();
 // Enrich only the known original demonstration records, never real imports.
 for(const [i,name] of ["José da Silva Martins","Maria de Souza Lima"].entries()){
   const doc=address(groups[i].city,groups[i].base);
   await pool.query("UPDATE zc_technicians SET address=$2 WHERE name=$1 AND address IN ('','Endereço fictício, homologação')",[name,formatAddress(doc)]);
   await pool.query("UPDATE zc_orders SET document_data=document_data||$2::jsonb,location=$3 WHERE created_by='Demonstração local' AND technician_name=$1 AND (location='' OR location='Endereço fictício, homologação')",[name,JSON.stringify({...doc,customer_address:formatAddress(doc),service_address_same:true}),formatAddress(doc)]);
 }
 for(const t of data.technicians){
   let st=(await stockPool.query("SELECT id FROM tecnicos WHERE nome=$1",[t.name])).rows[0];
   if(!st)st=(await stockPool.query("INSERT INTO tecnicos(nome) VALUES($1) RETURNING id",[t.name])).rows[0];
   const central=await transaction(pool,async db=>{
     let existing=await d.one(db,"SELECT * FROM zc_technicians WHERE name=$1 AND stock_technician_id=$2",[t.name,st.id]);if(existing)return existing;
     const tech=await o.insert(db,"zc_technicians",{name:t.name,address:formatAddress(t.address),stock_technician_id:st.id,price_install:8000+t.key*300,price_maintenance:6000+t.key*100,price_removal:5000,price_visit:3500});
     const access=await createTechnicianAccount(db,tech,actor,online?null:"rj-demo-"+t.key+"@example.test");
     credentials[tech.id]={name:t.name,login:access.login,expires_at:access.expires_at,temporary_password:access.temporary_password};
     await f.initialRate(db,tech,actor);
     // These are initial fictional rates, before any execution exists.
     await db.query("UPDATE zc_rates SET travel_km_cents=$2,travel_policy=$3::jsonb WHERE technician_id=$1",[tech.id,t.key%3===0?0:200+t.key*10,JSON.stringify({mode:t.key%3===0?"none":t.key%3===1?"excess":"full",included_meters:t.key%3===0?0:15000+t.key*1000})]);
     await db.query("INSERT INTO zc_closing_policies(technician_id,policy,updated_by) VALUES($1,$2::jsonb,$3)",[tech.id,JSON.stringify({unit:t.key%2?"weeks":"days",every:t.key%2?1:14,anchor:cal.add(d.today(),-28),due_days:2,due_business_days:true}),actor]);
     return tech;
   });
   techs.set(t.key,central);
   for(const category of ["RASTREADOR","TAG"]){
     let product=(await stockPool.query("SELECT id FROM produtos WHERE nome=$1 AND categoria=$2",["Modelo simulação RJ "+category,category])).rows[0];
     if(!product)product=(await stockPool.query("INSERT INTO produtos(nome,categoria) VALUES($1,$2) RETURNING id",["Modelo simulação RJ "+category,category])).rows[0];
     const count=category==="RASTREADOR"?(t.key===10?1:5+t.key%3):(t.key===10?0:3);
     const codes=Array.from({length:count},(_,j)=>category==="RASTREADOR"?"990"+String(t.key).padStart(3,"0")+String(j+1).padStart(9,"0"):"TAG-RJ-DEMO-"+t.key+"-"+(j+1));
     if(!codes.length)continue;
     const previous=(await stockPool.query("SELECT codigo_serial,status,produto_id FROM equipamentos_seriais WHERE codigo_serial=ANY($1::text[])",[codes])).rows;
     const existing=new Map(previous.map(item=>[item.codigo_serial,item]));
     const missing=codes.filter(code=>!existing.has(code));
     if(missing.length)await move(stockPool,"entrada",{produto_id:product.id,seriais:missing});
     const transfer=[...missing,...previous.filter(item=>item.status==="MATRIZ"&&item.produto_id===product.id).map(item=>item.codigo_serial)];
     if(transfer.length)await move(stockPool,"transferir",{produto_id:product.id,tecnico_id:st.id,seriais:transfer});
   }
 }
 for(const customer of data.customers){
   if(await d.one(pool,"SELECT id FROM zc_orders WHERE created_by=$1 AND customer_name=$2 AND parent_order_id IS NULL",[actor,customer.name]))continue;
   const installation=customer.service==="Instalação";
   await o.create(pool,{customer_name:customer.name,vehicle:customer.vehicle,service:customer.service,technician_id:null,scheduled_at:cal.add(d.today(),customer.day_offset)+"T"+customer.hour,status:"PENDENTE",fipe_value:installation?(customer.tag?"95000":"45000"):"",notes:"SIMULAÇÃO RJ — NÃO REALIZAR ATENDIMENTO OU CONTATO. "+(customer.approximate?"Número de teste não verificado.":"Referência de endereço público.")+" Fonte: "+customer.source,document_data:{...customer.address,service_address_same:true,vehicle_type:"Automóvel",fipe_region:"RJ",equipment_counts:{tracker:installation?1:0,tag:customer.tag?1:0}}},actor,{});
 }
 await pool.query("INSERT INTO zc_migration_runs(fingerprint,source,created_at,summary) VALUES($1,'local-fictional',$2,$3::jsonb)",[marker,d.now(),JSON.stringify({technicians:data.technicians.length,customers:data.customers.length})]);
 await resetOriginalAssignments(pool);
}
module.exports={seed,resetOriginalAssignments};
