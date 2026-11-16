const {test}=require("node:test");
const assert=require("node:assert/strict");
const {tier}=require("../src/storage-policy");
const {csvCell}=require("../src/orders-export");
test("politica usa mês atual e três anteriores, e mantém qualquer OS aberta no HOT",()=>{
  for(const [date,expected] of [["2026-11-01","HOT"],["2026-10-01","WARM"],["2026-08-31","WARM"],["2026-07-31","COLD"]]){
    const row={status:"CONCLUÍDO",created_date:date,completed_at:date};
    assert.equal(tier(row,"2026-11"),expected);
    assert.equal(tier({...row,status:"AGENDADO"},"2026-11"),"HOT");
  }
  assert.equal(tier({status:"CONCLUÍDO",created_date:"2026-01-01",completed_at:"2026-11-02"},"2026-11"),"HOT");
  assert.equal(tier({status:"CONCLUÍDO",created_date:"2025-10-01"},"2026-01"),"WARM");
});
test("CSV protege fórmulas e preserva separadores e aspas",()=>{
  assert.equal(csvCell('=1+1'),'"\'=1+1"');
  assert.equal(csvCell('A;B"'),'"A;B"""');
});
