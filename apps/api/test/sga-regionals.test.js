const test=require("node:test");
const assert=require("node:assert/strict");
const {collect,normalizeRegional,regionalRows}=require("../src/sga-regionals");
const row=(id,name="Regional "+id,status="ATIVO")=>({codigo_regional:id,descricao_regional:name,situacao:status});
test("normaliza o retorno documentado pelo SGA",()=>{
 assert.deepEqual(normalizeRegional(row(9)),{code:"9",name:"Regional 9",status:"ATIVO"});
 assert.equal(normalizeRegional(row("bad")),null);
 assert.deepEqual(regionalRows({regionais:[row(9)]}),[row(9)]);
 assert.throws(()=>regionalRows({mensagem:"Acesso negado"}));
});
test("consulta apenas leitura e separa conflitos",async()=>{
 const r=await collect({request:async(path,payload,mutation)=>{
 assert.equal(path,"/listar/regional/todos");assert.equal(payload,undefined);assert.equal(mutation,false);
 return [row(9),row(9),row(10),row(10,"Outro nome"),row(11,"Regional 11","INATIVO"),row("x")];
 }});
 assert.deepEqual(r.items,[{code:"9",name:"Regional 9",status:"ATIVO"},{code:"11",name:"Regional 11",status:"INATIVO"}]);
 assert.equal(r.duplicates,2);assert.equal(r.skipped,2);
});
test("não interpreta erro de permissão como catálogo vazio",async()=>{
 await assert.rejects(()=>collect({request:async()=>{throw Object.assign(Error("HTTP 406"),{upstreamStatus:406})}}),/406/);
});
