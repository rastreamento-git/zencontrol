const fs = require("node:fs/promises"),
  path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");
const { createHash, randomUUID } = require("node:crypto");
const { transaction } = require("./database");
const { fail } = require("./errors");
const d = require("./domain"),
  o = require("./orders");
const sourceNames = [
  "db_config.sqlite",
  "db_tecnicos.sqlite",
  "db_hot.sqlite",
  "db_warm.sqlite",
  "db_cold.sqlite",
];
const fields = [
  "legacy_id",
  "created_date",
  "service",
  "customer_name",
  "contact",
  "vehicle",
  "fipe_value",
  "fipe_risk",
  "volunteer",
  "imei",
  "term",
  "completed_at",
  "technician_name",
  "location",
  "created_by",
  "closed_by",
  "status",
  "shift",
  "scheduled_at",
  "notes",
  "sga_classification",
  "sga_status",
  "_reserved",
  "sga_id",
];
function readRows(db, table) {
  const allowed = [
    "tecnicos_bd",
    "tecnico_config_v3",
    "voluntarios",
    "ordens_servico",
    "os_extras_v1",
    "auditoria_financeira",
    "orders",
    "technicians",
    "volunteers",
    "order_extras",
    "settlements",
    "settlement_orders",
    "legacy_finance",
    "audit",
    "jobs",
    "webhook_events",
    "wa_sessions",
    "batches",
    "evidence",
    "migration_runs",
  ];
  if (!allowed.includes(table)) throw Error("Tabela inválida.");
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table)
  )
    return [];
  return db.prepare("SELECT * FROM " + table).all();
}
async function migration(pool, cfg, source, apply = false) {
  source = path.resolve(source);
  const report = {
    orders: 0,
    technicians: 0,
    volunteers: 0,
    extras: 0,
    legacy_finance: 0,
    conflicts: 0,
    legacy_statuses: {},
    warnings: [],
    dry_run: !apply,
  };
  let names;
  try {
    await fs.access(path.join(source, "zencontrol.sqlite"));
    names = ["zencontrol.sqlite"];
  } catch {
    names = [];
    for (const name of sourceNames) {
      try {
        await fs.access(path.join(source, name));
        names.push(name);
      } catch {}
    }
  }
  if (!names.length) fail(400, "Nenhum banco legado encontrado.");
  const snapshotDir = path.join(
    cfg.DATA_DIR,
    "backups",
    "legacy-" + randomUUID(),
  );
  await fs.mkdir(snapshotDir, { recursive: true });
  const connections = {},
    digest = createHash("sha256");
  for (const name of names) {
    const src = new DatabaseSync(path.join(source, name), { readOnly: true });
    const target = path.join(snapshotDir, name);
    try {
      await backup(src, target);
    } finally {
      src.close();
    }
    digest.update(name);
    digest.update(await fs.readFile(target));
    connections[name] = new DatabaseSync(target, { readOnly: true });
  }
  const fingerprint = digest.digest("hex");
  try {
    return await transaction(pool, async (db) => {
      if (
        await d.one(
          db,
          "SELECT 1 FROM zc_migration_runs WHERE fingerprint=$1",
          [fingerprint],
        )
      )
        return { ...report, already_imported: true };
      if (connections["zencontrol.sqlite"]) {
        for (const table of [
          "zc_orders",
          "zc_technicians",
          "zc_volunteers",
          "zc_batches",
          "zc_settlements",
        ]) {
          if (Number((await d.one(db, `SELECT count(*) n FROM ${table}`)).n))
            fail(
              409,
              "A migração da versão 4.0 exige uma base operacional vazia para preservar os vínculos e identificadores.",
            );
        }
        const sourceDb = connections["zencontrol.sqlite"];
        for (const table of [
          "technicians",
          "volunteers",
          "orders",
          "order_extras",
          "settlements",
          "settlement_orders",
          "legacy_finance",
          "audit",
          "jobs",
          "webhook_events",
          "wa_sessions",
          "batches",
          "evidence",
        ]) {
          const cols = (
            await d.rows(
              db,
              "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1",
              ["zc_" + table],
            )
          ).map((c) => c.column_name);
          for (const row of readRows(sourceDb, table)) {
            const data = Object.fromEntries(
              Object.entries(row).filter(([k]) => cols.includes(k)),
            );
            if ("active" in data) data.active = !!data.active;
            if ("hub" in data) data.hub = !!data.hub;
            if (
              table === "jobs" &&
              ["pending", "running"].includes(data.state)
            ) {
              data.state =
                data.kind === "download_evidence" ? "pending" : "uncertain";
              data.available_at = 0;
              data.last_error =
                "Tarefa migrada da versão 4.0. Confira o serviço externo antes de repetir.";
            }
            const keys = Object.keys(data);
            await db.query(
              `INSERT INTO zc_${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
              Object.values(data),
            );
            if (table === "orders") report.orders++;
            else if (table === "technicians") report.technicians++;
            else if (table === "volunteers") report.volunteers++;
            else if (table === "order_extras") report.extras++;
          }
          if (
            ["technicians", "volunteers", "order_extras", "audit"].includes(
              table,
            )
          )
            await db.query(
              `SELECT setval(pg_get_serial_sequence('zc_${table}','id'),COALESCE(MAX(id),1),MAX(id) IS NOT NULL) FROM zc_${table}`,
            );
        }
        if (apply) {
          const media = path.join(source, "media");
          await fs.mkdir(path.join(cfg.DATA_DIR, "media"), { recursive: true });
          for (const file of await d.rows(
            db,
            "SELECT path,original_path FROM zc_evidence WHERE path<>''",
          )) {
            for (const name of new Set(
              [file.path, file.original_path].filter(Boolean),
            )) {
              if (!/^[-a-f0-9]+\.jpg$/.test(name))
                fail(400, "Nome de foto inválido na base antiga.");
              try {
                await fs.copyFile(
                  path.join(media, name),
                  path.join(cfg.DATA_DIR, "media", name),
                );
              } catch {
                report.warnings.push(
                  "Uma foto da base 4.0 estava ausente; preserve a pasta original para conferência.",
                );
              }
            }
          }
        }
      } else {
        for (const file of ["db_config.sqlite", "db_tecnicos.sqlite"]) {
          const src = connections[file];
          if (!src) continue;
          for (const r of [
            ...readRows(src, "tecnico_config_v3"),
            ...readRows(src, "tecnicos_bd"),
          ]) {
            const name = String(r.nome || r.tecnico_nome || "").trim();
            if (!name) continue;
            const old = await d.one(
              db,
              "SELECT * FROM zc_technicians WHERE translate(name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=translate($1,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')",
              [name],
            );
            const data = {
              name,
              phone: String(r.telefone || r.whatsapp_privado || ""),
              address: String(r.endereco || r.endereco_base || ""),
              tags: String(r.tags || r.tags_habilidades || ""),
              receive_group: String(r.grupo_rec_jid || ""),
              receive_group_name: String(r.grupo_rec_nome || ""),
              send_group: String(r.grupo_env_jid || ""),
              send_group_name: String(r.grupo_env_nome || ""),
              active: file === "db_tecnicos.sqlite" || !!old?.active,
            };
            for (const [key, legacy] of [
              ["price_install", "val_instalacao"],
              ["price_maintenance", "val_manutencao"],
              ["price_removal", "val_retirada"],
              ["price_visit", "val_visita"],
            ]) {
              try {
                data[key] = d.money(r[legacy] || 0);
              } catch {
                data[key] = 0;
                report.warnings.push(
                  "Valor de técnico inválido preservado para conferência na origem.",
                );
              }
            }
            const extra = { ...(old?.extra_info || {}) };
            for (const key of ["cpf_cnpj", "chave_pix", "whatsapp_privado"])
              if (r[key]) extra[key] = r[key];
            data.extra_info = JSON.stringify(extra);
            if (old) {
              for (const [k, v] of Object.entries(data))
                if (v === "" && old[k]) data[k] = old[k];
              await o.update(db, "zc_technicians", "id", old.id, data);
            } else {
              await o.insert(db, "zc_technicians", data);
              report.technicians++;
            }
          }
          if (file === "db_config.sqlite")
            for (const r of readRows(src, "voluntarios")) {
              const name = String(r.nome || "").trim();
              if (!name) continue;
              const result = await db.query(
                "INSERT INTO zc_volunteers(name,sga_code) VALUES($1,$2) ON CONFLICT DO NOTHING",
                [name, String(r.codigo_sga || "")],
              );
              report.volunteers += result.rowCount;
            }
        }
        for (const [archive, file] of [
          ["HOT", "db_hot.sqlite"],
          ["WARM", "db_warm.sqlite"],
          ["COLD", "db_cold.sqlite"],
        ]) {
          if (!connections[file]) continue;
          for (const r of readRows(connections[file], "ordens_servico")) {
            let raw;
            try {
              raw = JSON.parse(r.dados);
            } catch {
              fail(
                400,
                "JSON inválido em " + file + ". Nenhum dado foi importado.",
              );
            }
            if (!Array.isArray(raw)) fail(400, "Formato de OS inválido.");
            const original = JSON.stringify(raw);
            const padded = [
              ...raw,
              ...Array(Math.max(0, 24 - raw.length)).fill(""),
            ];
            const data = Object.fromEntries(
              fields.map((k, i) => [k, String(padded[i] ?? "")]),
            );
            delete data._reserved;
            data.id = String(r.os_id);
            data.raw_legacy = original;
            const existing = await d.one(
              db,
              "SELECT id,raw_legacy FROM zc_orders WHERE id=$1",
              [data.id],
            );
            if (existing) {
              if (JSON.stringify(existing.raw_legacy) === original) continue;
              data.id +=
                "-" +
                archive +
                "-" +
                createHash("sha256").update(original).digest("hex").slice(0, 6);
              report.conflicts++;
              if (
                await d.one(db, "SELECT 1 FROM zc_orders WHERE id=$1", [
                  data.id,
                ])
              )
                continue;
            }
            data.legacy_status = data.status;
            data.status = d.legacyStatus(data.status);
            if (
              data.legacy_status &&
              data.status === "PENDENTE" &&
              data.legacy_status !== "PENDENTE"
            )
              report.legacy_statuses[data.legacy_status] =
                (report.legacy_statuses[data.legacy_status] || 0) + 1;
            if (!data.shift && ["Manhã", "Tarde"].includes(data.legacy_status))
              data.shift = data.legacy_status;
            data.created_date = d.date(data.created_date) || d.today();
            data.completed_at = d.date(data.completed_at) || data.completed_at;
            data.scheduled_at =
              d.date(data.scheduled_at, true) || data.scheduled_at;
            data.vehicle = d.vehicle(data.vehicle);
            if (data.vehicle.length > 7) data.chassis = data.vehicle;
            data.archive = archive;
            data.updated_at = d.now();
            if (data.technician_name) {
              let tech = await d.one(
                db,
                "SELECT id FROM zc_technicians WHERE translate(name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=translate($1,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')",
                [data.technician_name],
              );
              if (!tech) {
                tech = await o.insert(db, "zc_technicians", {
                  name: data.technician_name,
                  active: false,
                });
                report.technicians++;
              }
              data.technician_id = tech.id;
            }
            await o.insert(db, "zc_orders", data);
            report.orders++;
          }
        }
        const src = connections["db_config.sqlite"];
        if (src) {
          for (const r of readRows(src, "os_extras_v1")) {
            if (
              await d.one(db, "SELECT 1 FROM zc_orders WHERE id=$1", [
                String(r.os_id),
              ])
            ) {
              const result = await db.query(
                "INSERT INTO zc_order_extras(order_id,type,description,amount_cents,legacy_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(legacy_key) DO NOTHING",
                [
                  String(r.os_id),
                  String(r.tipo || "Extra"),
                  String(r.detalhes || ""),
                  d.money(r.valor || 0),
                  "extra:" + r.id,
                ],
              );
              report.extras += result.rowCount;
            } else
              await db.query(
                "INSERT INTO zc_legacy_finance VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING",
                ["extra:" + r.id, JSON.stringify(r)],
              );
          }
          for (const r of readRows(src, "auditoria_financeira")) {
            await db.query(
              "INSERT INTO zc_legacy_finance VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING",
              ["finance:" + r.id, JSON.stringify(r)],
            );
            report.legacy_finance++;
          }
        }
      }
      await db.query(
        "INSERT INTO zc_migration_runs VALUES($1,$2,$3::jsonb,$4)",
        [fingerprint, source, JSON.stringify(report), d.now()],
      );
      await d.audit(
        db,
        "migração",
        "legacy_import",
        "system",
        fingerprint,
        report,
      );
      if (!apply)
        throw Object.assign(Error("Simulação"), { dryReport: report });
      return report;
    });
  } catch (e) {
    if (e.dryReport) return e.dryReport;
    throw e;
  } finally {
    for (const db of Object.values(connections)) db.close();
  }
}
module.exports = { migration };
