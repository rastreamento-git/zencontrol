const { test } = require("node:test");
const assert = require("node:assert/strict");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const { reconcile } = require("../scripts/reconcile");
test("additive migration preserves a representative legacy schema and serial identities", async () => {
  const db = await testDatabase();
  try {
    const client = await db.pool.connect();
    try {
      await client.query(`CREATE TABLE produtos (id SERIAL PRIMARY KEY,nome VARCHAR(100),categoria VARCHAR(30),quantidade_matriz INTEGER DEFAULT 0,estoque_minimo INTEGER DEFAULT 5);
   CREATE TABLE tecnicos (id SERIAL PRIMARY KEY,nome VARCHAR(100),ativo BOOLEAN DEFAULT true,estoque_minimo INTEGER DEFAULT 5);
   CREATE TABLE estoque_tecnicos (tecnico_id INTEGER,produto_id INTEGER,quantidade INTEGER DEFAULT 0,PRIMARY KEY(tecnico_id,produto_id));
   CREATE TABLE equipamentos_seriais (id SERIAL PRIMARY KEY,codigo_serial VARCHAR(128) UNIQUE,produto_id INTEGER,tecnico_id INTEGER,status VARCHAR(20),data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
   CREATE TABLE movimentacoes (id SERIAL PRIMARY KEY,tipo VARCHAR(50),produto_id INTEGER,tecnico_id INTEGER,quantidade INTEGER,data TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
   INSERT INTO produtos (nome,categoria,quantidade_matriz) VALUES ('LEGACY','RASTREADOR',99);
   INSERT INTO equipamentos_seriais (codigo_serial,produto_id,status) VALUES ('0000001',1,'MATRIZ');
   INSERT INTO movimentacoes (tipo,produto_id,quantidade) VALUES ('ENTRADA_MATRIZ',1,1);`);
    } finally {
      client.release();
    }
    await migrate(db.pool);
    await migrate(db.pool);
    assert.equal(
      (await db.pool.query("SELECT quantidade_matriz FROM produtos")).rows[0]
        .quantidade_matriz,
      99,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT codigo_serial,arquivado FROM equipamentos_seriais",
        )
      ).rows[0].codigo_serial,
      "0000001",
    );
    assert.equal(
      Number(
        (await db.pool.query("SELECT COUNT(*) FROM movimentacoes")).rows[0]
          .count,
      ),
      1,
    );
    await reconcile(db.pool, true);
    assert.equal(
      (await db.pool.query("SELECT quantidade_matriz FROM produtos")).rows[0]
        .quantidade_matriz,
      1,
    );
  } finally {
    await db.close();
  }
});
