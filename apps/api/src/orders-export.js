const ExcelJS=require("exceljs");
const d=require("./domain");
const {fail}=require("./errors");
const {fipeCents}=require("../../../packages/domain/fipe.mjs");
const fields=[["id","Número da OS",20],["created_date","Data de abertura",18,"date"],["service","Serviço",30],["vehicle","Placa / chassi",25],["customer_name","Associado",35],["contact","Contato",22],["technician_name","Técnico",30],["status","Situação",29],["scheduled_at","Agendamento",23,"datetime"],["completed_at","Conclusão",18,"date"],["location","Local / endereço",45],["volunteer","Voluntário",28],["fipe_value","Valor FIPE (R$)",20,"money"],["fipe_risk","Classificação FIPE",24],["imei","IMEI / serial",28],["notes","Observações",60]];
const references={created:"created_date",scheduled:"scheduled_at",completed:"completed_at"};
function dateValue(v, type) {
  const raw=String(v||"");
  const date=d.date(raw.slice(0,10));
  if(!date)return null;
  const t=type==="datetime"&&/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)?raw.slice(11,16):"00:00";
  const value=new Date(date+"T"+t+":00Z");
  return Number.isNaN(value.getTime())?null:value;
}
function value(row,[key,, ,type],xlsx){
  const raw=row[key];
  if(type==="date"||type==="datetime"){
    const v=dateValue(raw,type);
    if(!v)return String(raw||"");
    if(xlsx)return v;
    return v.toISOString().slice(0,10).split("-").reverse().join("/")+(type==="datetime"&&String(raw).length>10?" "+v.toISOString().slice(11,16):"");
  }
  if(type==="money"){const n=fipeCents(raw);return n==null?String(raw||""):xlsx?n/100:(n/100).toFixed(2).replace(".",",");}
  return String(raw??"");
}
function csvCell(v){let s=String(v??"");if(/^[=+@-]/.test(s.trimStart())||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
async function exportOrders(pool,req,res,format){
  const start=req.query.start,end=req.query.end,reference=req.query.reference||"created";
  if(!Object.hasOwn(references,reference))fail(400,"Referência de data inválida.");
  if((start||end)&&(!start||!end||d.date(start)!==start||d.date(end)!==end||start>end))fail(400,"Informe um período válido.");
  const args=start?[start,end]:[], where=start?" AND substring("+references[reference]+",1,10) BETWEEN $1 AND $2":"";
  const rows=await d.rows(pool,"SELECT "+fields.map(x=>x[0]).join(",")+" FROM zc_orders WHERE deleted_at=''"+where+" ORDER BY "+references[reference]+",id",args);
  const filename="ZenControl-ordens"+(start?"-"+start+"-a-"+end:"-completo");
  if(format==="csv"){
    return res.type("text/csv; charset=utf-8").attachment(filename+".csv").send("\ufeff"+[fields.map(x=>x[1]),...rows.map(r=>fields.map(f=>value(r,f,false)))].map(r=>r.map(csvCell).join(";")).join("\r\n"));
  }
  res.attachment(filename+".xlsx").type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const book=new ExcelJS.stream.xlsx.WorkbookWriter({stream:res,useStyles:true,useSharedStrings:false});
  const sheet=book.addWorksheet("Ordens de serviço",{views:[{state:"frozen",ySplit:3,xSplit:1,showGridLines:false}]});
  sheet.columns=fields.map(f=>({width:f[2],style:f[3]==="money"?{numFmt:'"R$" #,##0.00'}:f[3]==="date"?{numFmt:"dd/mm/yyyy"}:f[3]==="datetime"?{numFmt:"dd/mm/yyyy hh:mm"}:{numFmt:"@"}}));
  sheet.mergeCells(1,1,1,fields.length);const title=sheet.getRow(1);title.getCell(1).value="ZENCONTROL | RELATÓRIO DE ORDENS DE SERVIÇO";title.height=32;title.getCell(1).font={name:"Calibri",size:18,bold:true,color:{argb:"FFFFFFFF"}};title.getCell(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF17365D"}};title.getCell(1).alignment={vertical:"middle"};title.commit();
  sheet.mergeCells(2,1,2,fields.length);const info=sheet.getRow(2);info.getCell(1).value=(start?start+" a "+end:"Todos os períodos")+" | "+rows.length+" ordens | Referência: "+({created:"abertura",scheduled:"agendamento",completed:"conclusão"}[reference]);info.getCell(1).font={italic:true,color:{argb:"FF475569"}};info.height=23;info.commit();
  const header=sheet.addRow(fields.map(f=>f[1]));header.height=25;header.eachCell(cell=>{cell.font={bold:true,color:{argb:"FFFFFFFF"}};cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF245690"}};cell.alignment={vertical:"middle",wrapText:true};});header.commit();
  sheet.autoFilter={from:{row:3,column:1},to:{row:3+rows.length,column:fields.length}};
  const colors={"CONCLUÍDO":"FFDCEFE2","CANCELADO":"FFF8DDDD","PENDENTE":"FFFFEAC7","AGENDADO":"FFDCEBFA"};
  for(const [idx,row] of rows.entries()){
    const line=sheet.addRow(fields.map(f=>value(row,f,true)));
    line.height=30;line.eachCell({includeEmpty:true},(cell,col)=>{cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:col===8?(colors[row.status]||"FFE8EEF5"):idx%2?"FFF0F5FA":"FFFFFFFF"}};cell.font={name:"Calibri",size:11,color:{argb:"FF18283D"},bold:col===8};cell.alignment={vertical:"middle",wrapText:[3,5,7,8,11,16].includes(col)};});line.commit();
  }
  sheet.commit();
  const summary=book.addWorksheet("Resumo",{views:[{state:"frozen",ySplit:1,showGridLines:false}]});
  summary.columns=[{width:35},{width:18}];const sh=summary.addRow(["Situação","Quantidade"]);sh.eachCell(cell=>{cell.font={bold:true,color:{argb:"FFFFFFFF"}};cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF245690"}};});sh.commit();
  const counts={};for(const row of rows)counts[row.status]=(counts[row.status]||0)+1;
  Object.entries(counts).sort().forEach(x=>summary.addRow(x).commit());const total=summary.addRow(["TOTAL",rows.length]);total.font={bold:true};total.commit();summary.commit();await book.commit();
}
module.exports={exportOrders,csvCell};
