const ExcelJS=require("exceljs");
const d=require("./domain");
const {fail}=require("./errors");
const {fipeCents}=require("../../../packages/domain/fipe.mjs");
// Operational layout follows the legacy monthly spreadsheet (A:S).
const fields=[
  ["id","NÚMERO DA OS",20],
  ["service","SERVIÇOS",29],
  ["customer_name","NOME DO ASSOCIADO",36],
  ["vehicle","PLACA / CHASSI",25],
  ["imei","IMEI",27],
  ["created_date","OS EMITIDA",18,"date"],
  ["completed_at","DATA DE CONCLUSÃO",23,"date"],
  ["technician_name","TÉCNICO",32],
  ["location","REGIÃO",36],
  ["volunteer","VOLUNTÁRIO",29],
  ["fipe_value","VALOR FIPE",20,"money"],
  ["fipe_risk","CLASSIFICAÇÃO FIPE",24],
  ["created_by","INCLUÍDO POR",26],
  ["closed_by","CONCLUÍDO POR",26],
  ["status","SITUAÇÃO",29],
  ["notes_1","OBSERVAÇÃO 1",40],
  ["notes_2","OBSERVAÇÃO 2",40],
  ["notes_3","OBSERVAÇÃO 3",40],
  ["notes_4","OBSERVAÇÃO 4",40],
  ["scheduled_at","AGENDAMENTO",23,"datetime"],
  ["contact","CONTATO",23],
];
const columns=[...new Set(fields.map(([key])=>key.startsWith("notes_")?"notes":key))];
const statusColumn=fields.findIndex(([key])=>key==="status")+1;
const wrapColumns=new Set(fields.flatMap(([key],i)=>["service","customer_name","technician_name","location","status","notes_1","notes_2","notes_3","notes_4"].includes(key)?[i+1]:[]));
function withNotes(row) {
  const notes=[[],[],[],[]];
  let current=0;
  for(const line of String(row.notes||"").split(/\r?\n/)){
    const match=/^([PQRS]):\s*(.*)$/.exec(line);
    if(match){current="PQRS".indexOf(match[1]);notes[current].push(match[2]);}
    else if(line)notes[current].push(line);
  }
  return {...row,...Object.fromEntries(notes.map((group,i)=>["notes_"+(i+1),group.join("\n")]))};
}
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
  const rows=(await d.rows(pool,"SELECT "+columns.join(",")+" FROM zc_orders WHERE deleted_at=''"+where+" ORDER BY "+references[reference]+",id",args)).map(withNotes);
  const filename="ZenControl-ordens"+(start?"-"+start+"-a-"+end:"-completo");
  if(format==="csv"){
    return res.type("text/csv; charset=utf-8").attachment(filename+".csv").send("\ufeff"+[fields.map(x=>x[1]),...rows.map(r=>fields.map(f=>value(r,f,false)))].map(r=>r.map(csvCell).join(";")).join("\r\n"));
  }
  res.attachment(filename+".xlsx").type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const book=new ExcelJS.stream.xlsx.WorkbookWriter({stream:res,useStyles:true,useSharedStrings:false});
  const sheet=book.addWorksheet("Ordens de serviço",{views:[{state:"frozen",ySplit:3,xSplit:1,showGridLines:false}]});
  sheet.columns=fields.map(f=>({width:f[2],style:f[3]==="money"?{numFmt:'"R$" #,##0.00'}:f[3]==="date"?{numFmt:"dd/mm/yyyy"}:f[3]==="datetime"?{numFmt:"dd/mm/yyyy hh:mm"}:{numFmt:"@"}}));
  sheet.mergeCells(1,1,1,fields.length);const title=sheet.getRow(1);title.getCell(1).value="ZENCONTROL | CONTROLE DE SERVIÇOS";title.height=32;title.getCell(1).font={name:"Calibri",size:18,bold:true,color:{argb:"FFFFFFFF"}};title.getCell(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF17365D"}};title.getCell(1).alignment={vertical:"middle"};title.commit();
  sheet.mergeCells(2,1,2,fields.length);const info=sheet.getRow(2);info.getCell(1).value=(start?start+" a "+end:"Todos os períodos")+" | "+rows.length+" ordens | Referência: "+({created:"emissão da OS",scheduled:"agendamento",completed:"conclusão"}[reference]);info.getCell(1).font={italic:true,color:{argb:"FF475569"}};info.height=23;info.commit();
  const header=sheet.addRow(fields.map(f=>f[1]));header.height=25;header.eachCell(cell=>{cell.font={bold:true,color:{argb:"FFFFFFFF"}};cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF245690"}};cell.alignment={vertical:"middle",wrapText:true};});header.commit();
  sheet.autoFilter={from:{row:3,column:1},to:{row:3+rows.length,column:fields.length}};
  const colors={"CONCLUÍDO":"FFDCEFE2","CANCELADO":"FFF8DDDD","PENDENTE":"FFFFEAC7","AGENDADO":"FFDCEBFA"};
  for(const [idx,row] of rows.entries()){
    const line=sheet.addRow(fields.map(f=>value(row,f,true)));
    line.height=Math.min(180,Math.max(30,...fields.flatMap(([key,,width])=>key.startsWith("notes_")?[String(row[key]||"").split("\n").reduce((n,l)=>n+Math.max(1,Math.ceil(l.length/Math.max(1,width-6))),0)*15+8]:[])));line.eachCell({includeEmpty:true},(cell,col)=>{cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:col===statusColumn?(colors[row.status]||"FFE8EEF5"):idx%2?"FFF0F5FA":"FFFFFFFF"}};cell.font={name:"Calibri",size:11,color:{argb:"FF18283D"},bold:col===statusColumn};cell.alignment={vertical:"middle",wrapText:wrapColumns.has(col)};});line.commit();
  }
  sheet.commit();
  const summary=book.addWorksheet("Resumo",{views:[{state:"frozen",ySplit:1,showGridLines:false}]});
  summary.columns=[{width:35},{width:18}];const sh=summary.addRow(["Situação","Quantidade"]);sh.eachCell(cell=>{cell.font={bold:true,color:{argb:"FFFFFFFF"}};cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF245690"}};});sh.commit();
  const counts={};for(const row of rows)counts[row.status]=(counts[row.status]||0)+1;
  Object.entries(counts).sort().forEach(x=>summary.addRow(x).commit());const total=summary.addRow(["TOTAL",rows.length]);total.font={bold:true};total.commit();summary.commit();await book.commit();
}
module.exports={exportOrders,csvCell,withNotes};
