const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs/promises");
const os = require("node:os"),
  path = require("node:path");
const { createHash } = require("node:crypto");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const { migration } = require("../src/legacy");
const { prepareBackup, restoreBackup, tables } = require("../src/backup");
const d = require("../src/domain"),
  o = require("../src/orders");
let db, pool, root, cfg, source, originalRow;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("backup remoto inclui originais, restaura no bucket e remove arquivos temporários", async () => {
  const { mockSupabase, config } = require("./helpers/supabase.cjs");
  const { createMediaStore } = require("../src/media-store");
  const remote = mockSupabase();
  const cloud = { ...cfg, ...config };
  let backup;
  try {
    await migration(pool, cfg, source, true);
    const item = await d.one(pool, "SELECT * FROM zc_orders LIMIT 1");
    await o.insert(pool, "zc_batches", {
      id: "cloud-batch",
      order_id: item.id,
      technician_id: item.technician_id,
      sender: "test",
      state: "review",
      created_at: d.now(),
    });
    const original = Buffer.from("original photo"),
      edited = Buffer.from("edited photo");
    const store = createMediaStore(cloud);
    await store.put("abc-111.jpg", original);
    await store.put("def-222.jpg", edited);
    await o.insert(pool, "zc_evidence", {
      id: "cloud-photo",
      batch_id: "cloud-batch",
      message_id: "test",
      path: "def-222.jpg",
      original_path: "abc-111.jpg",
      mime: "image/jpeg",
      sha256: hash(edited),
      state: "ready",
    });
    backup = await prepareBackup(pool, cloud);
    assert.equal(backup.files.length, 2);
    assert.equal(
      JSON.parse(backup.manifest).media["abc-111.jpg"],
      hash(original),
    );
    const target = path.join(root, "cloud-backup");
    await fs.mkdir(path.join(target, "media"), { recursive: true });
    await fs.writeFile(path.join(target, "database.json"), backup.database);
    await fs.writeFile(path.join(target, "manifest.json"), backup.manifest);
    for (const file of backup.files)
      await fs.copyFile(file.local, path.join(target, file.name));
    await backup.cleanup();
    await assert.rejects(fs.access(backup.files[0].local), { code: "ENOENT" });
    await pool.query(
      "TRUNCATE " + tables.join(",") + " RESTART IDENTITY CASCADE",
    );
    remote.objects.clear();
    await restoreBackup(pool, cloud, target);
    assert.equal(remote.objects.size, 0);
    await restoreBackup(pool, cloud, target, true);
    assert.deepEqual(await store.read("abc-111.jpg"), original);
    assert.deepEqual(await store.read("def-222.jpg"), edited);
    remote.state.failDownload = true;
    await assert.rejects(prepareBackup(pool, cloud), /foto referenciada/);
  } finally {
    await backup?.cleanup();
    remote.restore();
  }
});
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "zencontrol-migration-"));
  source = path.join(root, "original");
  await fs.mkdir(source);
  cfg = { DATA_DIR: path.join(root, "data") };
  const config = new DatabaseSync(path.join(source, "db_config.sqlite"));
  config.exec(`CREATE TABLE tecnico_config_v3(tecnico_nome TEXT PRIMARY KEY,whatsapp_privado TEXT,val_instalacao REAL,cpf_cnpj TEXT,chave_pix TEXT);
    INSERT INTO tecnico_config_v3 VALUES('Técnico Exemplo','5511999999999',80.20,'documento-ficticio','chave-ficticia');
    CREATE TABLE voluntarios(nome TEXT PRIMARY KEY,codigo_sga TEXT); INSERT INTO voluntarios VALUES('Voluntário Exemplo','123');
    CREATE TABLE usuarios(id INTEGER PRIMARY KEY,login TEXT,senha TEXT); INSERT INTO usuarios VALUES(1,'antigo','nao-importar');
    CREATE TABLE os_extras_v1(id INTEGER PRIMARY KEY,os_id TEXT,tipo TEXT,detalhes TEXT,valor REAL); INSERT INTO os_extras_v1 VALUES(1,'LEG-001','Pedágio','Exemplo',1.30);
    CREATE TABLE auditoria_financeira(id INTEGER PRIMARY KEY,detalhes TEXT); INSERT INTO auditoria_financeira VALUES(1,'Histórico financeiro de exemplo');`);
  config.close();
  const techs = new DatabaseSync(path.join(source, "db_tecnicos.sqlite"));
  techs.exec(
    "CREATE TABLE tecnicos_bd(nome TEXT PRIMARY KEY,telefone TEXT,val_instalacao REAL); INSERT INTO tecnicos_bd VALUES('Técnico Exemplo','5511999999999',90.20)",
  );
  techs.close();
  originalRow = [
    "LEG-001",
    "01/09/2026",
    "Instalação",
    "Associado Exemplo",
    "5511000000000",
    "ABC-1A23",
    "45000",
    "Normal",
    "Voluntário Exemplo",
    "123456789012345",
    "Termo",
    "02/09/2026",
    "Técnico Exemplo",
    "Endereço Exemplo",
    "Operador A",
    "Operador B",
    "Manhã",
    "",
    "03/09/2026 08:30",
    "Texto antigo",
    "Classificação",
    "Situação",
    "Reservado",
    "987",
  ];
  const hot = new DatabaseSync(path.join(source, "db_hot.sqlite"));
  hot.exec("CREATE TABLE ordens_servico(os_id TEXT PRIMARY KEY,dados TEXT)");
  hot
    .prepare("INSERT INTO ordens_servico VALUES(?,?)")
    .run("LEG-001", JSON.stringify(originalRow));
  hot.close();
  db = await testDatabase();
  pool = db.pool;
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query(
    "TRUNCATE " + tables.join(",") + " RESTART IDENTITY CASCADE",
  );
});
after(async () => {
  if (db) await db.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});
test("simulação usa cópia consistente, não altera destino ou bancos SQLite", async () => {
  const original = hash(await fs.readFile(path.join(source, "db_hot.sqlite")));
  const report = await migration(pool, cfg, source);
  assert.equal(report.dry_run, true);
  assert.equal(report.orders, 1);
  assert.equal(report.technicians, 1);
  assert.equal(report.volunteers, 1);
  assert.equal(
    Number((await d.one(pool, "SELECT count(*) n FROM zc_orders")).n),
    0,
  );
  assert.equal(
    Number((await d.one(pool, "SELECT count(*) n FROM zc_migration_runs")).n),
    0,
  );
  assert.equal(
    hash(await fs.readFile(path.join(source, "db_hot.sqlite"))),
    original,
  );
  assert.ok((await fs.readdir(path.join(cfg.DATA_DIR, "backups"))).length);
});
test("importação preserva as 24 posições, consolida técnicos e não copia senhas", async () => {
  const report = await migration(pool, cfg, source, true);
  assert.equal(report.orders, 1);
  assert.equal(report.extras, 1);
  assert.equal(report.legacy_finance, 1);
  const row = await d.one(pool, "SELECT * FROM zc_orders WHERE id=$1", [
    "LEG-001",
  ]);
  assert.deepEqual(row.raw_legacy, originalRow);
  assert.equal(row.status, "PENDENTE");
  assert.equal(row.legacy_status, "Manhã");
  assert.equal(row.shift, "Manhã");
  assert.equal(row.created_date, "2026-09-01");
  assert.equal(row.scheduled_at, "2026-09-03T08:30");
  assert.equal(row.vehicle, "ABC1A23");
  assert.equal(row.sga_id, "987");
  const tech = await d.one(pool, "SELECT * FROM zc_technicians WHERE id=$1", [
    row.technician_id,
  ]);
  assert.equal(tech.active, true);
  assert.equal(tech.price_install, 9020);
  assert.equal(tech.extra_info.cpf_cnpj, "documento-ficticio");
  assert.equal(
    Number((await d.one(pool, "SELECT count(*) n FROM usuarios")).n),
    0,
  );
  assert.equal(
    (await migration(pool, cfg, source, true)).already_imported,
    true,
  );
  assert.equal(
    Number((await d.one(pool, "SELECT count(*) n FROM zc_orders")).n),
    1,
  );
});
test("conflito de identificador preserva ambas as ordens diferentes", async () => {
  const other = path.join(root, "conflict");
  await fs.mkdir(other);
  await fs.copyFile(
    path.join(source, "db_hot.sqlite"),
    path.join(other, "db_hot.sqlite"),
  );
  const cold = new DatabaseSync(path.join(other, "db_cold.sqlite"));
  cold.exec("CREATE TABLE ordens_servico(os_id TEXT PRIMARY KEY,dados TEXT)");
  const changed = [...originalRow];
  changed[19] = "Conteúdo diferente";
  cold
    .prepare("INSERT INTO ordens_servico VALUES(?,?)")
    .run("LEG-001", JSON.stringify(changed));
  cold.close();
  const report = await migration(pool, cfg, other, true);
  assert.equal(report.conflicts, 1);
  assert.equal(report.orders, 2);
  assert.equal(
    Number((await d.one(pool, "SELECT count(*) n FROM zc_orders")).n),
    2,
  );
});
test("JSON inválido causa rollback de toda a importação", async () => {
  const invalid = path.join(root, "invalid");
  await fs.mkdir(invalid);
  await fs.copyFile(
    path.join(source, "db_config.sqlite"),
    path.join(invalid, "db_config.sqlite"),
  );
  const hot = new DatabaseSync(path.join(invalid, "db_hot.sqlite"));
  hot.exec(
    "CREATE TABLE ordens_servico(os_id TEXT PRIMARY KEY,dados TEXT); INSERT INTO ordens_servico VALUES('INV','{invalido')",
  );
  hot.close();
  await assert.rejects(migration(pool, cfg, invalid, true), /JSON inválido/);
  assert.equal(
    Number((await d.one(pool, "SELECT count(*) n FROM zc_technicians")).n),
    0,
  );
});
test("migração 4.0 mantém IDs e prepara sequências para os próximos cadastros", async () => {
  const v4 = path.join(root, "v4");
  await fs.mkdir(v4);
  const old = new DatabaseSync(path.join(v4, "zencontrol.sqlite"));
  old.exec(`CREATE TABLE technicians(id INTEGER PRIMARY KEY,name TEXT,active INTEGER,extra_info TEXT); INSERT INTO technicians VALUES(25,'TÉCNICO 4.0',1,'{}'); INSERT INTO technicians VALUES(26,'Técnico 4.0',0,'{}');
    CREATE TABLE orders(id TEXT PRIMARY KEY,created_date TEXT,service TEXT,vehicle TEXT,status TEXT,updated_at TEXT,technician_id INTEGER,raw_legacy TEXT);
    INSERT INTO orders VALUES('OS-4','2026-09-01','Instalação','AAA1234','PENDENTE','2026-09-01T12:00:00Z',25,'[]');`);
  old.close();
  const report = await migration(pool, cfg, v4, true);
  assert.equal(report.orders, 1);
  assert.equal(
    (
      await d.one(pool, "SELECT technician_id FROM zc_orders WHERE id=$1", [
        "OS-4",
      ])
    ).technician_id,
    25,
  );
  assert.equal(
    Number((await d.one(pool, "SELECT count(*) n FROM zc_technicians")).n),
    2,
  );
  assert.equal(
    (await o.insert(pool, "zc_technicians", { name: "Próximo técnico" })).id,
    27,
  );
  assert.equal((await migration(pool, cfg, v4, true)).already_imported, true);
  const different = path.join(root, "v4-different");
  await fs.mkdir(different);
  await fs.copyFile(
    path.join(v4, "zencontrol.sqlite"),
    path.join(different, "zencontrol.sqlite"),
  );
  const edit = new DatabaseSync(path.join(different, "zencontrol.sqlite"));
  edit.exec("UPDATE orders SET vehicle='BBB4321'");
  edit.close();
  await assert.rejects(
    migration(pool, cfg, different, true),
    /base operacional vazia/,
  );
});
async function backupFixture() {
  await migration(pool, cfg, source, true);
  await pool.query("UPDATE zc_orders SET document_data=$1::jsonb", [
    JSON.stringify(require("./fixtures/order-document.cjs").document_data),
  ]);
  const backup = await prepareBackup(pool, cfg),
    target = path.join(root, "backup-" + Date.now());
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "database.json"), backup.database);
  await fs.writeFile(path.join(target, "manifest.json"), backup.manifest);
  return { target, backup };
}
test("backup operacional inclui integridade, exclui contas e restaura de forma atômica", async () => {
  const { target, backup } = await backupFixture();
  const snapshot = JSON.parse(backup.database);
  assert.equal(snapshot.data.usuarios, undefined);
  assert.equal(backup.database.toString().includes("nao-importar"), false);
  await pool.query(
    "TRUNCATE " + tables.join(",") + " RESTART IDENTITY CASCADE",
  );
  const dry = await restoreBackup(pool, cfg, target);
  assert.equal(dry.dry_run, true);
  assert.equal(dry.tables.zc_orders, 1);
  assert.equal(
    Number((await d.one(pool, "SELECT count(*) n FROM zc_orders")).n),
    0,
  );
  const restored = await restoreBackup(pool, cfg, target, true);
  assert.equal(restored.dry_run, false);
  assert.deepEqual(
    (await d.one(pool, "SELECT document_data FROM zc_orders")).document_data,
    require("./fixtures/order-document.cjs").document_data,
  );
  assert.deepEqual(
    (await d.one(pool, "SELECT raw_legacy FROM zc_orders")).raw_legacy,
    originalRow,
  );
  await assert.rejects(
    restoreBackup(pool, cfg, target, true),
    /base operacional vazia/,
  );
});
test("backup adulterado é rejeitado antes de gravar qualquer registro", async () => {
  const { target } = await backupFixture();
  await pool.query(
    "TRUNCATE " + tables.join(",") + " RESTART IDENTITY CASCADE",
  );
  await fs.appendFile(path.join(target, "database.json"), " ");
  await assert.rejects(restoreBackup(pool, cfg, target, true), /integridade/);
  assert.equal(
    Number((await d.one(pool, "SELECT count(*) n FROM zc_orders")).n),
    0,
  );
});
test("restauração não executa novamente envios pendentes recuperados", async () => {
  await migration(pool, cfg, source, true);
  await o.enqueue(
    pool,
    "dispatch",
    "LEG-001",
    { version: 1 },
    "teste-dispatch",
  );
  await o.enqueue(
    pool,
    "download_evidence",
    "LEG-001",
    { batch_id: "exemplo" },
    "teste-download",
  );
  const backup = await prepareBackup(pool, cfg),
    target = path.join(root, "jobs-backup");
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "database.json"), backup.database);
  await fs.writeFile(path.join(target, "manifest.json"), backup.manifest);
  await pool.query(
    "TRUNCATE " + tables.join(",") + " RESTART IDENTITY CASCADE",
  );
  await restoreBackup(pool, cfg, target, true);
  assert.equal(
    (
      await d.one(pool, "SELECT state FROM zc_jobs WHERE idempotency_key=$1", [
        "teste-dispatch",
      ])
    ).state,
    "uncertain",
  );
  assert.equal(
    (
      await d.one(pool, "SELECT state FROM zc_jobs WHERE idempotency_key=$1", [
        "teste-download",
      ])
    ).state,
    "pending",
  );
});
