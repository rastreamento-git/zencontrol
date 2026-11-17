const {test}=require("node:test");
const assert=require("node:assert/strict");
const {closingFrequency,paymentDescription}=require("../../../packages/domain/payment-language.mjs");
test("linguagem de pagamento distingue datas fixas, intervalos e dias úteis",()=>{
 const base={unit:"twice_monthly",every:1,days:[15,31],due_days:5,due_business_days:true};
 assert.equal(closingFrequency(base),"Duas vezes por mês");
 assert.match(paymentDescription(base),/dia 15 e no último dia do mês/);
 assert.match(paymentDescription(base),/5 dias úteis após o encerramento/);
 assert.match(paymentDescription({...base,unit:"weeks",every:2,due_business_days:false}),/a cada 14 dias.*5 dias corridos/);
 assert.match(paymentDescription({...base,unit:"months",cut_day:31,due_days:0}),/último dia do mês.*próximo dia útil/);
 assert.match(paymentDescription({...base,unit:"days",every:15,business_days:false}),/a cada 15 dias/);
 assert.equal(paymentDescription({...base,days:[20,10]}),"");
});
