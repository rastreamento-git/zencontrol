const d=require("./domain"),{fail}=require("./errors");
const serviceType=`CASE WHEN document_data->>'visit_outcome'='unproductive' OR service='Improdutiva' THEN 'Visita improdutiva'
 WHEN document_data->>'visit_outcome'='reschedule' THEN 'Reagendamento'
 WHEN service LIKE 'Reinstalação%' THEN 'Reinstalação'
 WHEN service LIKE 'Instalação%' THEN 'Instalação'
 WHEN service LIKE 'Manutenção%' THEN 'Manutenção'
 WHEN service LIKE 'Retirada%' THEN 'Retirada'
 WHEN service='Visita' THEN 'Visita (legado)' ELSE 'Outros' END`;
const services=["Instalação","Manutenção","Retirada","Reinstalação","Visita improdutiva","Reagendamento","Visita (legado)","Outros"];
function filters(q){
 const from=q.day||q.agenda_from,to=q.day||q.agenda_to;
 if(typeof from!=="string"||typeof to!=="string"||d.date(from)!==from||d.date(to)!==to||from>to||Date.parse(to)-Date.parse(from)>366*86400000)fail(400,"Informe um período válido de até 367 dias.");
 const args=[from,to],conditions=["substring(scheduled_at,1,10) BETWEEN $1 AND $2"];
 const add=(sql,v)=>{args.push(v);conditions.push(sql.replace("?",String(args.length)))};
 if(q.technician_id==="unassigned")conditions.push("technician_id IS NULL");
 else if(q.technician_id){if(!/^\d+$/.test(String(q.technician_id))||Number(q.technician_id)<1||Number(q.technician_id)>2147483647)fail(400,"Técnico inválido.");add("technician_id=$?",Number(q.technician_id));}
 if(q.service_type){if(!services.includes(q.service_type))fail(400,"Tipo de serviço inválido.");add("("+serviceType+")=$?",q.service_type);}
 if(q.status){if(!d.statuses.includes(q.status))fail(400,"Situação inválida.");add("status=$?",q.status);}
 if(q.q){args.push("%"+String(q.q).slice(0,200)+"%");const p="$"+args.length;conditions.push("(id ILIKE "+p+" OR vehicle ILIKE "+p+" OR customer_name ILIKE "+p+" OR technician_name ILIKE "+p+")");}
 return {from,to,args,conditions:conditions.join(" AND "),base:"deleted_at='' AND parent_order_id IS NULL"};
}
async function summarize(db,filter){
 const rows=await d.rows(db,`WITH matched AS (
   SELECT eligible.id AS id, substring(scheduled_at,1,10) AS scheduled_day,
     technician_id, COALESCE(NULLIF(technician_name,''),'Sem técnico') AS technician_name,
     (${serviceType}) AS service_type, status
   FROM zc_orders AS eligible WHERE ${filter.base} AND ${filter.conditions}
 ), extras AS (
   SELECT child.parent_order_id, count(*) AS additional_count
   FROM zc_orders AS child JOIN matched AS m ON child.parent_order_id=m.id
   WHERE child.deleted_at='' GROUP BY child.parent_order_id
 )
 SELECT m.scheduled_day AS "day", m.technician_id, m.technician_name,
   m.service_type, m.status, count(*)::integer AS appointments,
   COALESCE(sum(e.additional_count),0)::integer AS additional_orders
 FROM matched AS m LEFT JOIN extras AS e ON e.parent_order_id=m.id
 GROUP BY m.scheduled_day,m.technician_id,m.technician_name,m.service_type,m.status
 ORDER BY m.scheduled_day,m.technician_name,m.service_type,m.status`,filter.args);
 const byService=new Map(),byTechnician=new Map(),totals={appointments:0,additional_orders:0,cancelled:0,completed:0,open:0};
 for(const row of rows){const n=row.appointments;totals.appointments+=n;totals.additional_orders+=row.additional_orders;
 if(row.status==="CANCELADO")totals.cancelled+=n;else if(row.status==="CONCLUÍDO")totals.completed+=n;else totals.open+=n;
 const s=byService.get(row.service_type)||{service_type:row.service_type,appointments:0,cancelled:0,completed:0};s.appointments+=n;s.cancelled+=row.status==="CANCELADO"?n:0;s.completed+=row.status==="CONCLUÍDO"?n:0;byService.set(s.service_type,s);
 const t=byTechnician.get(row.technician_id)||{technician_id:row.technician_id,technician_name:row.technician_name,appointments:0,completed:0,cancelled:0,services:{}};t.appointments+=n;t.completed+=row.status==="CONCLUÍDO"?n:0;t.cancelled+=row.status==="CANCELADO"?n:0;t.services[row.service_type]=(t.services[row.service_type]||0)+n;byTechnician.set(row.technician_id,t);
 }
 return {period:{from:filter.from,to:filter.to},date_reference:"scheduled_at",unit:"primary_attendance",totals,by_service:[...byService.values()],by_technician:[...byTechnician.values()].sort((a,b)=>b.appointments-a.appointments||a.technician_name.localeCompare(b.technician_name,"pt-BR")),rows};
}
module.exports={filters,summarize,services,serviceType};
