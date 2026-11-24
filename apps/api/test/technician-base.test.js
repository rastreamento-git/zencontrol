const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeBase}=require("../src/technician-base");
const {addressParts}=require("../src/routing-providers");
const example={cep:"25000-000",street:"Rua Exemplo",number:"47",district:"Centro",city:"Duque de Caxias",state:"rj",complement:"Sala 2",transport:"moto",radius_km:"30",municipalities:"Caxias e Rio"};
test("normaliza base operacional para o parser de rotas",()=>{
 const n=normalizeBase(example);
 assert.equal(n.base.cep,"25000000");
 assert.equal(n.base.radius_km,30);
 assert.equal(n.base.state,"RJ");
 assert.equal(n.address,"Rua Exemplo, 47, Centro, Duque de Caxias, RJ");
 assert.equal(addressParts(n.address).city,"Duque de Caxias");
 assert.equal(n.base.complement,"Sala 2");
});
test("rejeita endereços incompletos ou ambíguos",()=>{
 for(const patch of [{cep:"123"},{number:"s/n"},{city:""},{state:"ZZ"},{street:"Rua, Exemplo"},{radius_km:-1},{transport:"invalid"}])assert.throws(()=>normalizeBase({...example,...patch}));
});
