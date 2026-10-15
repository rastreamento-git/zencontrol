const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { transaction } = require("./database");
const { fail } = require("./errors");
const d = require("./domain");
const tables = [
  "zc_technicians",
  "zc_volunteers",
  "zc_orders",
  "zc_order_extras",
  "zc_settlements",
  "zc_settlement_orders",
  "zc_legacy_finance",
  "zc_audit",
  "zc_jobs",
  "zc_webhook_events",
  "zc_wa_sessions",
  "zc_batches",
  "zc_evidence",
  "zc_migration_runs",
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const photoName = /^[-a-f0-9]+\.jpg$/;
async function prepareBackup(pool, cfg) {
  const snapshot = await transaction(pool, async (db) => {
    const data = {};
    for (const t of tables)
      data[t] = (await db.query("SELECT * FROM " + t)).rows;
    return {
      format: "zencontrol-postgres",
      version: 1,
      exportedAt: d.now(),
      data,
      service_rules: (
        await db.query("SELECT * FROM zc_service_rules ORDER BY service")
      ).rows,
    };
  });
  const database = Buffer.from(JSON.stringify(snapshot));
  const files = [],
    media = {};
  for (const name of new Set(
    snapshot.data.zc_evidence
      .flatMap((e) => [e.path, e.original_path])
      .filter(Boolean),
  )) {
    if (!photoName.test(name))
      fail(
        409,
        "Uma foto possui referência inválida. Corrija antes de gerar o backup.",
      );
    const local = path.join(cfg.DATA_DIR, "media", name);
    let bytes;
    try {
      bytes = await fs.readFile(local);
    } catch {
      fail(
        409,
        "Uma foto referenciada está ausente. Restaure o arquivo antes de gerar o backup.",
      );
    }
    media[name] = sha(bytes);
    files.push({ local, name: "media/" + name });
  }
  const manifest = Buffer.from(
    JSON.stringify(
      {
        format: "zencontrol-backup",
        version: 1,
        databaseSha256: sha(database),
        media,
      },
      null,
      2,
    ),
  );
  return { database, manifest, files };
}
async function readSafe(root, relative, max) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep))
    fail(400, "Caminho de backup inválido.");
  const info = await fs.lstat(target);
  const actual = await fs.realpath(target);
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    !actual.startsWith(root + path.sep) ||
    info.size > max
  )
    fail(400, "Arquivo de backup inválido.");
  return fs.readFile(target);
}
async function restoreBackup(pool, cfg, source, apply = false) {
  const root = await fs.realpath(path.resolve(source));
  let manifest, snapshot;
  const database = await readSafe(root, "database.json", 150 * 1024 * 1024);
  try {
    manifest = JSON.parse(
      await readSafe(root, "manifest.json", 5 * 1024 * 1024),
    );
    snapshot = JSON.parse(database);
  } catch {
    fail(400, "JSON de backup inválido.");
  }
  if (
    manifest.format !== "zencontrol-backup" ||
    manifest.version !== 1 ||
    manifest.databaseSha256 !== sha(database) ||
    snapshot.format !== "zencontrol-postgres" ||
    snapshot.version !== 1 ||
    !snapshot.data ||
    !manifest.media ||
    typeof manifest.media !== "object" ||
    Array.isArray(manifest.media)
  )
    fail(400, "Formato ou integridade do backup inválidos.");
  if (Object.keys(snapshot.data).sort().join() !== [...tables].sort().join())
    fail(400, "As tabelas do backup não correspondem a esta versão.");
  const media = new Map();
  for (const [name, checksum] of Object.entries(manifest.media)) {
    if (!photoName.test(name) || !/^[a-f0-9]{64}$/.test(checksum))
      fail(400, "Referência de foto inválida no backup.");
    const bytes = await readSafe(root, "media/" + name, 16 * 1024 * 1024);
    if (sha(bytes) !== checksum)
      fail(400, "Uma foto do backup falhou na verificação de integridade.");
    media.set(name, bytes);
  }
  if (!Array.isArray(snapshot.data.zc_evidence))
    fail(400, "Fotos em formato inválido.");
  for (const e of snapshot.data.zc_evidence)
    for (const name of [e.path, e.original_path].filter(Boolean))
      if (!media.has(name))
        fail(400, "Uma foto referenciada não está no backup.");
  const report = {
    dry_run: !apply,
    tables: {},
    photos: media.size,
    accounts:
      "Contas atuais preservadas; não fazem parte do backup operacional.",
  };
  try {
    await transaction(pool, async (tx) => {
      for (const table of tables)
        if (Number((await d.one(tx, "SELECT count(*) n FROM " + table)).n))
          fail(
            409,
            "A restauração exige uma base operacional vazia. Use um banco novo e pare o worker.",
          );
      for (const table of tables) {
        const rows = snapshot.data[table];
        if (!Array.isArray(rows)) fail(400, "Tabela inválida no backup.");
        const columns = await d.rows(
          tx,
          "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1",
          [table],
        );
        const allowed = new Map(
          columns.map((c) => [c.column_name, c.data_type]),
        );
        report.tables[table] = rows.length;
        for (const row of rows) {
          if (!row || typeof row !== "object" || Array.isArray(row))
            fail(400, "Linha inválida no backup.");
          const copy = { ...row };
          if (
            table === "zc_jobs" &&
            ["pending", "running"].includes(copy.state)
          ) {
            copy.state = ["download_evidence", "stock_installation"].includes(
              copy.kind,
            )
              ? "pending"
              : "uncertain";
            copy.last_error =
              "Tarefa recuperada de backup. Confira o serviço externo antes de repetir.";
            copy.available_at = 0;
          }
          if (table === "zc_batches") copy.source_user_id = null;
          const keys = Object.keys(copy);
          if (!keys.length || keys.some((k) => !allowed.has(k)))
            fail(400, "Coluna inválida no backup.");
          const values = keys.map((k) =>
            allowed.get(k) === "jsonb" ? JSON.stringify(copy[k]) : copy[k],
          );
          await tx.query(
            `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
            values,
          );
        }
        if (
          [
            "zc_technicians",
            "zc_volunteers",
            "zc_order_extras",
            "zc_audit",
          ].includes(table)
        )
          await tx.query(
            `SELECT setval(pg_get_serial_sequence('${table}','id'),COALESCE(MAX(id),1),MAX(id) IS NOT NULL) FROM ${table}`,
          );
      }
      if (snapshot.service_rules !== undefined) {
        if (
          !Array.isArray(snapshot.service_rules) ||
          snapshot.service_rules.length !== 6
        )
          fail(400, "Regras do backup inválidas.");
        const seen = new Set();
        for (const r of snapshot.service_rules) {
          if (
            !r ||
            !d.services.includes(r.service) ||
            seen.has(r.service) ||
            !Array.isArray(r.required_photos) ||
            !r.required_photos.length ||
            r.required_photos.length > 5
          )
            fail(400, "Regra do backup inválida.");
          seen.add(r.service);
          const current = await d.one(
            tx,
            "SELECT * FROM zc_service_rules WHERE service=$1",
            [r.service],
          );
          if (
            r.stock_action !== current.stock_action ||
            r.min_serials !== current.min_serials ||
            !Number.isInteger(r.version) ||
            r.version < 1
          )
            fail(400, "Regra de estoque do backup inválida.");
          const kinds = new Set();
          let total = 0;
          for (const p of r.required_photos) {
            if (
              !p ||
              !["vehicle", "label", "installed", "service", "other"].includes(
                p.kind,
              ) ||
              kinds.has(p.kind) ||
              !Number.isInteger(p.min) ||
              p.min < 1 ||
              p.min > 10 ||
              typeof p.label !== "string" ||
              !p.label.trim() ||
              p.label.length > 120
            )
              fail(400, "Regra de fotos do backup inválida.");
            kinds.add(p.kind);
            total += p.min;
          }
          if (
            total > 30 ||
            (r.stock_action === "install" && !kinds.has("label"))
          )
            fail(400, "Evidências do backup inválidas.");
          await tx.query(
            "UPDATE zc_service_rules SET required_photos=$1::jsonb,version=$2 WHERE service=$3",
            [JSON.stringify(r.required_photos), r.version, r.service],
          );
        }
      }
      if (!apply)
        throw Object.assign(Error("Simulação"), { dryReport: report });
      await fs.mkdir(path.join(cfg.DATA_DIR, "media"), { recursive: true });
      for (const [name, bytes] of media) {
        const target = path.join(cfg.DATA_DIR, "media", name);
        try {
          await fs.writeFile(target, bytes, { flag: "wx" });
        } catch (e) {
          if (
            e.code !== "EEXIST" ||
            sha(await fs.readFile(target)) !== sha(bytes)
          )
            throw e;
        }
      }
      await d.audit(
        tx,
        "restauração",
        "backup_restored",
        "system",
        snapshot.exportedAt,
        report,
      );
    });
  } catch (e) {
    if (e.dryReport) return e.dryReport;
    throw e;
  }
  return report;
}
module.exports = { prepareBackup, restoreBackup, tables };
