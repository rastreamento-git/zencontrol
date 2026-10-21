const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path"),
  os = require("node:os");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const { purge } = require("../src/purge");
const { tables } = require("../src/backup");
const o = require("../src/orders"),
  d = require("../src/domain");
let db, pool, root, cfg, order;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zencontrol-purge-"));
  cfg = { DATA_DIR: path.join(root, "data"), ROOT: path.join(root, "project") };
  db = await testDatabase();
  pool = db.pool;
  await migrate(pool);
  await pool.query(
    "CREATE TABLE inventario_equipamentos(id INTEGER PRIMARY KEY,imei TEXT)",
  );
  await pool.query(
    "INSERT INTO inventario_equipamentos VALUES(1,'123456789012345')",
  );
  await pool.query(
    "INSERT INTO usuarios(login,nome,senha_hash,papel) VALUES('admin','Administrador de exemplo','hash-preservado','admin')",
  );
});
beforeEach(async () => {
  await pool.query(
    "TRUNCATE " + tables.join(",") + " RESTART IDENTITY CASCADE",
  );
  await fs.rm(cfg.DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(cfg.DATA_DIR, "media"), { recursive: true });
  await fs.mkdir(path.join(cfg.DATA_DIR, "backups", "legacy"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(cfg.DATA_DIR, "media", "foto-exemplo.jpg"),
    "foto de exemplo",
  );
  await fs.writeFile(
    path.join(cfg.DATA_DIR, "backups", "legacy", "original.sqlite"),
    "backup de exemplo",
  );
  await fs.writeFile(
    path.join(cfg.DATA_DIR, ".env"),
    "CONFIGURACAO_DE_EXEMPLO=preservar",
  );
  await fs.writeFile(path.join(root, "outside.txt"), "arquivo externo");
  const tech = await o.insert(pool, "zc_technicians", {
    name: "Técnico de exemplo",
  });
  order = await o.create(
    pool,
    {
      vehicle: "TES1234",
      customer_name: "Associado de exemplo",
      service: "Instalação",
      technician_id: tech.id,
    },
    "teste",
  );
  await o.insert(pool, "zc_volunteers", { name: "Voluntário de exemplo" });
  await o.enqueue(pool, "dispatch", order.id, { version: 1 }, "job-exemplo");
});
after(async () => {
  if (db) await db.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});
test("simulação mostra o alcance sem apagar registros ou arquivos", async () => {
  const result = await purge(pool, cfg);
  assert.equal(result.dry_run, true);
  assert.equal(result.database_purged, false);
  assert.equal(result.tables.zc_orders, 1);
  assert.equal(result.accounts_preserved, 1);
  assert.equal((await o.get(pool, order.id)).vehicle, "TES1234");
  assert.equal(
    await fs.readFile(
      path.join(cfg.DATA_DIR, "media", "foto-exemplo.jpg"),
      "utf8",
    ),
    "foto de exemplo",
  );
});
test("limpeza com mídia remota é recusada antes de alterar o banco", async () => {
  await assert.rejects(
    purge(pool, { ...cfg, MEDIA_STORAGE: "supabase" }, { apply: true }),
    /Nenhum dado foi apagado/,
  );
  assert.equal((await o.get(pool, order.id)).vehicle, "TES1234");
});
test("limpeza esvazia tabelas e fotos do ZenControl e preserva inventário e acessos", async () => {
  const result = await purge(pool, cfg, { apply: true });
  assert.equal(result.database_purged, true);
  assert.equal(result.files_purged, true);
  for (const t of tables)
    assert.equal(
      Number((await d.one(pool, "SELECT count(*) n FROM " + t)).n),
      0,
      t,
    );
  assert.equal(
    (await d.one(pool, "SELECT senha_hash FROM usuarios")).senha_hash,
    "hash-preservado",
  );
  assert.equal(
    (await d.one(pool, "SELECT imei FROM inventario_equipamentos")).imei,
    "123456789012345",
  );
  assert.equal(
    Number((await d.one(pool, "SELECT count(*) n FROM schema_migrations")).n),
    10,
  );
  await assert.rejects(fs.access(path.join(cfg.DATA_DIR, "media")));
  await assert.rejects(fs.access(path.join(cfg.DATA_DIR, "backups")));
  assert.equal(
    await fs.readFile(path.join(cfg.DATA_DIR, ".env"), "utf8"),
    "CONFIGURACAO_DE_EXEMPLO=preservar",
  );
  assert.equal(
    await fs.readFile(path.join(root, "outside.txt"), "utf8"),
    "arquivo externo",
  );
  assert.equal(
    (await o.insert(pool, "zc_technicians", { name: "Primeiro técnico novo" }))
      .id,
    1,
  );
});
test("limpeza repetida é idempotente e não cria cópia dos dados purgados", async () => {
  await purge(pool, cfg, { apply: true });
  const result = await purge(pool, cfg, { apply: true });
  assert.equal(result.total_rows, 0);
  assert.equal(result.files_purged, true);
  assert.deepEqual(await fs.readdir(cfg.DATA_DIR), [".env"]);
});
test("tarefas em execução bloqueiam a limpeza sem alterações parciais", async () => {
  await pool.query("UPDATE zc_jobs SET state='running'");
  await assert.rejects(
    purge(pool, cfg, { apply: true }),
    /tarefas em execução/,
  );
  assert.ok(await o.get(pool, order.id));
  assert.ok(await fs.stat(path.join(cfg.DATA_DIR, "media")));
});
test("dependência externa impede truncamento e mantém os dois projetos intactos", async () => {
  await pool.query(
    "CREATE TABLE inventario_ref_os(os_id TEXT REFERENCES zc_orders(id))",
  );
  try {
    await pool.query("INSERT INTO inventario_ref_os VALUES($1)", [order.id]);
    await assert.rejects(purge(pool, cfg, { apply: true }));
    assert.ok(await o.get(pool, order.id));
    assert.equal(
      Number((await d.one(pool, "SELECT count(*) n FROM inventario_ref_os")).n),
      1,
    );
    assert.ok(
      await fs.stat(path.join(cfg.DATA_DIR, "media", "foto-exemplo.jpg")),
    );
  } finally {
    await pool.query("DROP TABLE inventario_ref_os");
  }
});
test("schema incompleto não é tratado como banco ZenControl válido", async () => {
  await pool.query(
    "ALTER TABLE zc_migration_runs RENAME TO saved_migration_runs",
  );
  try {
    await assert.rejects(purge(pool, cfg, { apply: true }), /schema completo/);
    assert.ok(await o.get(pool, order.id));
  } finally {
    await pool.query(
      "ALTER TABLE saved_migration_runs RENAME TO zc_migration_runs",
    );
  }
});
test("link para arquivo externo é recusado antes de apagar qualquer dado", async (t) => {
  try {
    await fs.symlink(
      path.join(root, "outside.txt"),
      path.join(cfg.DATA_DIR, "media", "external.txt"),
    );
  } catch (e) {
    if (["EPERM", "EACCES"].includes(e.code)) {
      t.skip("Sistema não permite criar links sem privilégios.");
      return;
    }
    throw e;
  }
  await assert.rejects(purge(pool, cfg, { apply: true }), /contém um link/);
  assert.ok(await o.get(pool, order.id));
  assert.equal(
    await fs.readFile(path.join(root, "outside.txt"), "utf8"),
    "arquivo externo",
  );
});
