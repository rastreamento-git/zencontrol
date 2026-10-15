const fs = require("node:fs/promises");
const path = require("node:path");
const { transaction } = require("./database");
const { fail } = require("./errors");
const { tables: backupTables } = require("./backup");
const tables = [...backupTables, "zc_technician_accounts"];
const d = require("./domain");

const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const folders = ["media", "backups"];
async function countTree(directory) {
  let files = 0,
    bytes = 0;
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    fail(
      409,
      "A pasta de dados contém um caminho inesperado. Nenhuma limpeza foi iniciada.",
    );
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const item = await fs.lstat(target);
    if (item.isSymbolicLink())
      fail(
        409,
        "A pasta de dados contém um link. Remova o link antes da limpeza.",
      );
    if (item.isDirectory()) {
      const nested = await countTree(target);
      files += nested.files;
      bytes += nested.bytes;
    } else if (item.isFile()) {
      files++;
      bytes += item.size;
    } else fail(409, "Tipo de arquivo inesperado na pasta de dados.");
  }
  return { files, bytes };
}
async function filePlan(cfg) {
  if (!cfg.DATA_DIR || !path.isAbsolute(cfg.DATA_DIR))
    fail(400, "Configure uma pasta de dados absoluta.");
  let root;
  try {
    const item = await fs.lstat(cfg.DATA_DIR);
    if (!item.isDirectory() || item.isSymbolicLink())
      fail(409, "ZEN_DATA_DIR precisa ser uma pasta real, sem link.");
    root = await fs.realpath(cfg.DATA_DIR);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const forbidden = [
    path.parse(root).root,
    process.cwd(),
    cfg.ROOT,
    process.env.HOME,
  ]
    .filter(Boolean)
    .map((p) => path.resolve(p));
  if (forbidden.includes(root))
    fail(
      409,
      "ZEN_DATA_DIR aponta para uma pasta protegida. Nenhuma limpeza foi iniciada.",
    );
  const plan = [];
  for (const name of folders) {
    const target = path.join(root, name);
    try {
      plan.push({ name, target, ...(await countTree(target)) });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return plan;
}
async function purge(pool, cfg, { apply = false } = {}) {
  // The explicit zc_* table list and these two folders form the entire scope.
  const files = await filePlan(cfg);
  const report = await transaction(pool, async (db) => {
    const identity = await d.one(
      db,
      "SELECT current_database() database,current_schema() schema",
    );
    const found = await d.rows(
      db,
      "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type=$1",
      ["BASE TABLE"],
    );
    const present = new Set(found.map((t) => t.table_name));
    if (
      tables.some((t) => !present.has(t)) ||
      !present.has("usuarios") ||
      !present.has("schema_migrations")
    )
      fail(
        409,
        "Este banco não contém o schema completo do ZenControl 6. Execute as migrações no banco correto.",
      );
    const qualified = tables.map(
      (t) => quote(identity.schema) + "." + quote(t),
    );
    if (apply)
      await db.query(
        "LOCK TABLE " + qualified.join(",") + " IN ACCESS EXCLUSIVE MODE",
      );
    const counts = {};
    for (let i = 0; i < tables.length; i++)
      counts[tables[i]] = Number(
        (await d.one(db, "SELECT count(*) n FROM " + qualified[i])).n,
      );
    const running = Number(
      (await d.one(db, "SELECT count(*) n FROM zc_jobs WHERE state='running'"))
        .n,
    );
    if (apply && running)
      fail(
        409,
        "Existem tarefas em execução. Pare API e worker e aguarde sua conclusão antes de limpar.",
      );
    const result = {
      format: "zencontrol-purge",
      version: 1,
      dry_run: !apply,
      database: identity.database,
      schema: identity.schema,
      tables: counts,
      total_rows: Object.values(counts).reduce((a, b) => a + b, 0),
      accounts_preserved: Number(
        (await d.one(db, "SELECT count(*) n FROM usuarios")).n,
      ),
      files: files.map(({ target, ...item }) => item),
      running_jobs: running,
      database_purged: false,
      files_purged: false,
    };
    if (apply) {
      // RESTRICT refuses foreign-key dependencies from tables outside ZenControl.
      await db.query(
        "TRUNCATE TABLE " + qualified.join(",") + " RESTART IDENTITY RESTRICT",
      );
      result.database_purged = true;
    }
    return result;
  });
  if (!apply) return report;
  const errors = [];
  for (const file of files) {
    try {
      const info = await fs.lstat(file.target);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error("unsafe");
      await fs.rm(file.target, { recursive: true });
    } catch (e) {
      if (e.code !== "ENOENT") errors.push(file.name);
    }
  }
  report.files_purged = errors.length === 0;
  if (errors.length) report.cleanup_pending = errors;
  return report;
}
module.exports = { purge };
