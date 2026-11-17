const {fail}=require("./errors");
const fallback={mode:"manual",included_meters:0};
function validatePolicy(value=fallback){
 if(!value||!["manual","none","excess","full"].includes(value.mode)||!Number.isSafeInteger(value.included_meters)||value.included_meters<0||value.included_meters>10000000)fail(400,"Informe uma regra de deslocamento válida e a distância incluída.");
 return {mode:value.mode,included_meters:["excess","full"].includes(value.mode)?value.included_meters:0};
}
function estimate(distance,rate){
 if(!Number.isSafeInteger(distance)||distance<0||distance>10000000)fail(400,"Distância inválida.");
 const p=validatePolicy(rate?.travel_policy||fallback),cents=rate?.travel_km_cents??0;
 if(p.mode==="manual")return {state:"manual",billable_meters:null,amount_cents:null};
 if(p.mode==="none")return {state:"none",billable_meters:0,amount_cents:0};
 if(!Number.isSafeInteger(cents)||cents<=0||cents>100000)fail(400,"Configure um valor por km maior que zero.");
 const billable=distance<=p.included_meters?0:p.mode==="full"?distance:distance-p.included_meters;
 const amount=Math.round(billable*cents/1000);
 if(amount>100000000)fail(400,"Valor de deslocamento acima do limite.");
 return {state:billable?"charged":"included",billable_meters:billable,amount_cents:amount};
}
module.exports={validatePolicy,estimate};
