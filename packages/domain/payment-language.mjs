const dayName=n=>Number(n)===31?"último dia do mês":"dia "+n;
const interval=(n,one,many)=>Number(n)===1?"1 "+one:n+" "+many;
export function closingFrequency(p){
 if(!p)return "";
 const n=p.every??1;
 if(p.unit==="weeks")return n===1?"Semanal":n===2?"A cada 14 dias":"A cada "+interval(n,"semana","semanas");
 if(p.unit==="days")return "A cada "+interval(n,p.business_days?"dia útil":"dia",p.business_days?"dias úteis":"dias");
 if(p.unit==="twice_monthly")return "Duas vezes por mês";
 return n===1?"Mensal":"A cada "+interval(n,"mês","meses");
}
export function paymentDescription(p){
 if(!p)return "";
 const n=p.every??1, due=Number(p.due_days);
 if(!Number.isInteger(n)||n<1||n>366||!Number.isInteger(due)||due<0||due>365)return "";
 let closing;
 if(p.unit==="twice_monthly"){
   const [first,second]=p.days||[15,31];
   if(!Number.isInteger(first)||!Number.isInteger(second)||first<1||second>31||first>=second)return "";
   closing="Os serviços serão agrupados para fechamento no "+dayName(first)+" e no "+dayName(second)+".";
 }else if(p.unit==="months"){
   const day=p.cut_day||Number(String(p.anchor||"").slice(8));
   if(!Number.isInteger(day)||day<1||day>31)return "";
   closing="Os serviços serão agrupados para fechamento "+(n===1?"todo mês":"a cada "+interval(n,"mês","meses"))+", no "+dayName(day)+".";
 }else if(p.unit==="weeks"||p.unit==="days"){
   closing="Os serviços serão agrupados para fechamento "+(p.unit==="weeks"?"a cada "+interval(n*7,"dia","dias"):closingFrequency(p).toLowerCase())+".";
 }else return "";
 const payment=due===0?(p.due_business_days?"O pagamento vence no dia do fechamento ou no próximo dia útil.":"O pagamento vence no dia do fechamento."):
 "O pagamento vence "+interval(due,p.due_business_days?"dia útil":"dia corrido",p.due_business_days?"dias úteis":"dias corridos")+" após o encerramento do período.";
 const note=(p.unit==="months"||p.unit==="twice_monthly")?" Em meses mais curtos, a data de fechamento é limitada ao último dia do mês.":"";
 return closing+" "+payment+note;
}
