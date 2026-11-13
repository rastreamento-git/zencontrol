const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const { transaction } = require("../src/database");
const {
  nextOrderId,
  importNumbering,
  numberingDate,
} = require("../src/order-numbering");
let db;
before(async () => {
  db = await testDatabase();
  await migrate(db.pool);
});
after(async () => {
  await db.close();
});
const reserve = (day) => transaction(db.pool, (tx) => nextOrderId(tx, day));
test("sequência hexadecimal diária: 001, 009, 00A, 00F, 010 e reinício por data", async () => {
  const ids = [];
  for (let i = 0; i < 16; i++) ids.push(await reserve("2026-11-13"));
  assert.equal(ids[0], "20261113001");
  assert.equal(ids[8], "20261113009");
  assert.equal(ids[9], "2026111300A");
  assert.equal(ids[14], "2026111300F");
  assert.equal(ids[15], "20261113010");
  assert.equal(await reserve("2026-11-14"), "20261114001");
  assert.equal(await reserve("2026-10-30"), "20261030001");
});
test("reservas simultâneas não repetem números e falhas não consomem sequência", async () => {
  const ids = await Promise.all(
    Array.from({ length: 24 }, () => reserve("2026-12-01")),
  );
  assert.equal(new Set(ids).size, 24);
  assert.equal(ids.at(-1), "20261201018");
  await assert.rejects(
    transaction(db.pool, async (tx) => {
      await nextOrderId(tx, "2026-12-02");
      throw Error("rollback esperado");
    }),
    /rollback/,
  );
  assert.equal(await reserve("2026-12-02"), "20261202001");
});
test("FFF é o último número e o limite não muda a data nem grava reservas parciais", async () => {
  await db.pool.query(
    "INSERT INTO zc_order_counters(day,last_value) VALUES('2026-12-03',4094)",
  );
  assert.equal(await reserve("2026-12-03"), "20261203FFF");
  await assert.rejects(
    reserve("2026-12-03"),
    (e) => e.status === 409 && /4095 OS/.test(e.message),
  );
  assert.equal(await reserve("2026-12-04"), "20261204001");
  await db.pool.query(
    "INSERT INTO zc_order_counters(day,last_value) VALUES('2026-12-05',4094)",
  );
  await assert.rejects(
    transaction(db.pool, async (tx) => {
      await nextOrderId(tx, "2026-12-05");
      await nextOrderId(tx, "2026-12-05");
    }),
    /4095 OS/,
  );
  assert.equal(await reserve("2026-12-05"), "20261205FFF");
});
test("contador ausente recupera o maior número existente e preserva sequência após exclusão", async () => {
  await db.pool.query(
    "INSERT INTO zc_orders(id,service,vehicle,status,created_date,updated_at) VALUES('2026120600F','Instalação','ABC1D23','PENDENTE','2026-12-06','2026-12-06')",
  );
  assert.equal(await reserve("2026-12-06"), "20261206010");
  await db.pool.query("DELETE FROM zc_orders WHERE id='2026120600F'");
  assert.equal(await reserve("2026-12-06"), "20261206011");
});
test("importação usa o termo, nunca conclusão/agendamento; ausência usa data de importação identificada", () => {
  assert.deepEqual(importNumbering("2026-10-30", "2026-11-13"), {
    date: "2026-10-30",
    source: "term",
  });
  assert.deepEqual(importNumbering("", "2026-11-13"), {
    date: "2026-11-13",
    source: "import_date",
  });
  for (const bad of [
    "2026-02-29",
    "2026-13-01",
    "2026-10-30T12:00",
    "30/10/2026",
    "0000-01-01",
  ])
    assert.throws(() => numberingDate(bad), /inválida/);
  assert.equal(numberingDate("2028-02-29"), "2028-02-29");
});
