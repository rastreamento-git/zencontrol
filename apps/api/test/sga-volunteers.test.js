const test=require("node:test");
const assert=require("node:assert/strict");
const {collect,normalizeRow,pageRows}=require("../src/sga-volunteers");
const row=(id,name="Corretor "+id)=>({codigo_voluntario:String(id),nome:name,situacao:"ATIVO",cpf:"ignorar",email:"ignorar"});
test("normaliza apenas os dados necessários",()=>{
 assert.deepEqual(normalizeRow(row(8)),{code:"8",name:"Corretor 8",status:"ATIVO"});
 assert.equal(normalizeRow({codigo_voluntario:"x",nome:"Inválido"}),null);
 assert.deepEqual(pageRows({dados:row(8)}),[row(8)]);
 assert.throws(()=>pageRows({mensagem:"Não autorizado"}));
});
test("consulta páginas a partir de zero, sem mutações e deduplica códigos",async()=>{
 const calls=[];
 const result=await collect({request:async(path,payload,mutation)=>{
  calls.push([path,payload,mutation]);
  return calls.length===1?Array.from({length:5000},(_,i)=>row(i+1)):[row(5000),row(5001),row(5002,"")];
 }});
 assert.deepEqual(calls,[["/listar/voluntario/todos/0",undefined,false],["/listar/voluntario/todos/1",undefined,false]]);
 assert.equal(result.items.length,5001);assert.equal(result.duplicates,1);assert.equal(result.invalid,1);
});
test("ignora identificador com respostas conflitantes",async()=>{
 const r=await collect({request:async()=>[row(1),row(1,"Outro"),row(2)]});
 assert.equal(r.conflicts,1);assert.deepEqual(r.items.map(x=>x.code),["2"]);
});
test("propaga falha real e não confunde 406 não autorizado com lista vazia",async()=>{
 await assert.rejects(()=>collect({request:async()=>{throw Object.assign(Error("HTTP 406"),{upstreamStatus:406})}}),/406/);
 const r=await collect({request:async()=>{throw Object.assign(Error("Nenhum registro encontrado"),{upstreamStatus:406,noRecords:true})}});
 assert.equal(r.items.length,0);
});
