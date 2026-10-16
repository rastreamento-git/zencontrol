const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { createMediaStore, validateMediaConfig } = require("../src/media-store");
const { databaseConfig } = require("../src/database");
const { mockSupabase, config } = require("./helpers/supabase.cjs");
const remote = mockSupabase();
after(() => remote.restore());
test("Supabase mantém fotos imutáveis e permite repetir o mesmo envio", async () => {
  const store = createMediaStore(config);
  await store.ready();
  await store.put("abc-123.jpg", Buffer.from("photo"));
  await store.put("abc-123.jpg", Buffer.from("photo"));
  assert.equal((await store.read("abc-123.jpg")).toString(), "photo");
  await assert.rejects(
    store.put("abc-123.jpg", Buffer.from("different")),
    /Armazenamento/,
  );
  assert.equal((await store.read("abc-123.jpg")).toString(), "photo");
  await assert.rejects(store.read("../abc-123.jpg"), /Referência/);
});
test("bucket público e falhas de armazenamento não são aceitos silenciosamente", async () => {
  const store = createMediaStore(config);
  remote.state.public = true;
  await assert.rejects(store.ready(), /privado/);
  remote.state.public = false;
  remote.state.failUpload = true;
  await assert.rejects(
    store.put("def-456.jpg", Buffer.from("photo")),
    /Armazenamento/,
  );
  assert.equal(remote.objects.has("def-456.jpg"), false);
  remote.state.failUpload = false;
});
test("configuração recusa chave pública, URLs externas e pools acima da cota", () => {
  assert.throws(
    () =>
      validateMediaConfig({
        ...config,
        SUPABASE_SECRET_KEY: "sb_publishable_test",
      }),
    /chave secreta/,
  );
  assert.throws(
    () =>
      validateMediaConfig({ ...config, SUPABASE_URL: "https://example.com" }),
    /Project URL/,
  );
  assert.throws(
    () =>
      validateMediaConfig({ ...config, SUPABASE_STORAGE_BUCKET: "../bucket" }),
    /bucket privado/,
  );
  const db = { DATABASE_URL: "postgres://test:test@localhost/test" };
  assert.equal(databaseConfig(db).max, 3);
  assert.equal(databaseConfig({ ...db, DATABASE_POOL_MAX: "2" }).max, 2);
  assert.throws(
    () => databaseConfig({ ...db, DATABASE_POOL_MAX: "21" }),
    /DATABASE_POOL_MAX/,
  );
});
