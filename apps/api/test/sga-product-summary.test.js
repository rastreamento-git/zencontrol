const {test}=require("node:test");
const assert=require("node:assert/strict");
const {productSummary,isTrackerProduct,isPerfuradoProduct}=require("../../../packages/domain/sga-product-summary.mjs");
test("resumo usa somente produtos confirmados e mantém estado desconhecido",()=>{
 assert.deepEqual(productSummary(),{tracker:null,perfurado:null});
 assert.deepEqual(productSummary({state:"unavailable",perfurado:true}),{tracker:null,perfurado:null});
 assert.deepEqual(productSummary({state:"available",perfurado:true,items:[{name:"RASTREADOR",active:true}]}),{tracker:true,perfurado:true});
 assert.equal(productSummary({state:"available",items:[{name:"Rastreador",active:null}]}).tracker,null);
 assert.equal(productSummary({state:"available",items:[{name:"SEM RASTREADOR",active:true},{name:"Retirada de Rastreador",active:true},{name:"Assistência 24h",active:true}]}).tracker,false);
 assert.equal(isPerfuradoProduct({kind:"product",code:"2371"}),true);
 assert.equal(isTrackerProduct({name:"Rastreamento Gold"}),false);
});
