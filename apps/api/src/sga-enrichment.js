const { randomUUID } = require("node:crypto");
const d = require("./domain");
const { fail } = require("./errors");
const { transaction } = require("./database");
const { documentFields } = require("./order-document");
const allowed = [
  "sga_id",
  "customer_name",
  "contact",
  "chassis",
  "location",
  "volunteer",
  "fipe_value",
  "sga_classification",
  "sga_status",
];
const norm = (v) => d.normalized(v || "").replace(/\s+/g, " ");
const filled = (v) => v !== null && v !== undefined && String(v).trim() !== "";
const valid = (v) =>
  /^(?:[A-Z]{3}\d[A-Z0-9]\d{2}|[A-HJ-NPR-Z0-9]{17})$/.test(d.vehicle(v));
function completeRow(row, result, mode = "fill_missing") {
  const copy = structuredClone(row);
  if (!copy.data) return copy;
  if (row.sga?.original) {
    for (const [field, value] of Object.entries(row.sga.original)) {
      if (field.startsWith("document_data.")) {
        copy.data.document_data ||= {};
        copy.data.document_data[field.slice(14)] = value;
      } else copy.data[field] = value;
    }
  }
  if (row.sga?.original_state) {
    copy.state = row.sga.original_state;
    copy.reason = row.sga.original_reason;
    copy.validation_issues = row.sga.original_issues;
  }

  copy.sga = {
    status: result.status,
    checked_at: d.now(),
    message: result.message || "",
    filled: [],
    conflicts: [],
    original_state: copy.state,
    original_reason: copy.reason,
    original_issues: copy.validation_issues || [],
  };
  if (result.status !== "found") return copy;
  const remote = result.data;
  const identity = d.vehicle(copy.data.vehicle);
  if (
    ![d.vehicle(remote.vehicle), d.vehicle(remote.chassis)].includes(identity)
  ) {
    copy.sga.status = "conflict";
    copy.sga.message =
      "O veículo retornado não corresponde à placa/chassi de origem.";
    return copy;
  }
  if (
    mode !== "prefer_sga" &&
    copy.data.customer_name &&
    norm(copy.data.customer_name) !== norm(remote.customer_name)
  ) {
    copy.sga.status = "conflict";
    copy.sga.message =
      "Nome do associado diverge. Confira o vínculo ou escolha usar o cadastro SGA na revisão.";
    copy.sga.conflicts.push({
      field: "customer_name",
      original: copy.data.customer_name,
      sga: remote.customer_name,
    });
    return copy;
  }
  function merge(target, source, keys, prefix = "") {
    for (const key of keys) {
      const incoming = source?.[key];
      if (!filled(incoming)) continue;
      const previous = target[key];
      if (!filled(previous) || mode === "prefer_sga") {
        if (String(previous ?? "") !== String(incoming)) {
          copy.sga.filled.push(prefix + key);
          copy.sga.original ||= {};
          copy.sga.original[prefix + key] = previous ?? "";
          target[key] = String(incoming);
        }
      } else if (norm(previous) !== norm(incoming))
        copy.sga.conflicts.push({
          field: prefix + key,
          original: previous,
          sga: incoming,
        });
    }
  }
  merge(copy.data, remote, allowed);
  copy.data.document_data ||= {};
  merge(
    copy.data.document_data,
    remote.document_data,
    Object.keys(documentFields),
    "document_data.",
  );
  const issues = (copy.validation_issues || []).filter(
    (issue) =>
      !(
        issue === "Nome e placa/chassi válidos são obrigatórios" &&
        copy.data.customer_name &&
        valid(copy.data.vehicle)
      ),
  );
  copy.validation_issues = issues;
  if (copy.state === "pending" && !issues.length) {
    copy.state = "ready";
    copy.reason = "";
  } else if (issues.length) copy.reason = issues.join("; ");
  if (copy.sga.conflicts.length) copy.sga.status = "conflict";
  return copy;
}
function createEnrichment({ app, pool, client, admin, rebuild, revision }) {
  let queue = Promise.resolve();
  const active = new Set();
  const heartbeat = setInterval(() => {
    if (active.size)
      pool
        .query(
          "UPDATE zc_sga_import_tasks SET updated_at=now() WHERE run_id=ANY($1::uuid[]) AND state IN ('queued','running')",
          [[...active]],
        )
        .catch(() => {});
  }, 30000);
  heartbeat.unref?.();
  const status = async (id, db = pool) => {
    const task = await d.one(
      db,
      "SELECT * FROM zc_sga_import_tasks WHERE batch_id=$1",
      [id],
    );
    if (
      task &&
      ["running", "queued"].includes(task.state) &&
      Date.now() - new Date(task.updated_at).getTime() > 180000
    ) {
      await db.query(
        "UPDATE zc_sga_import_tasks SET state='interrupted',message='Consulta interrompida. Gere uma nova revisão para tentar novamente.' WHERE batch_id=$1 AND run_id=$2",
        [id, task.run_id],
      );
      task.state = "interrupted";
    }
    return (
      task || {
        state: client.ready() ? "idle" : "not_configured",
        message: client.ready()
          ? ""
          : "Configure a consulta SGA no servidor para preencher automaticamente.",
      }
    );
  };
  async function work(batch, task, actor) {
    try {
      const current = await status(batch.id);
      if (current.run_id !== task.run_id) return;
      const source = batch.plan.source;
      const selected = source.filter(
        (r) =>
          batch.plan.selected_sheets.includes(r.sheet) &&
          r.data &&
          valid(r.data.vehicle),
      );
      const keys = [...new Set(selected.map((r) => d.vehicle(r.data.vehicle)))],
        results = new Map();
      await pool.query(
        "UPDATE zc_sga_import_tasks SET state='running',total=$3,updated_at=now() WHERE batch_id=$1 AND run_id=$2",
        [batch.id, task.run_id, keys.length],
      );
      // Fail once on invalid credentials instead of attempting a login per row.
      if (keys.length) await client.token();
      for (const [index, key] of keys.entries()) {
        const check = await d.one(
          pool,
          "SELECT run_id FROM zc_sga_import_tasks WHERE batch_id=$1",
          [batch.id],
        );
        if (check?.run_id !== task.run_id) return;
        try {
          results.set(key, {
            status: "found",
            data: await client.lookup({ term: key }),
          });
        } catch (error) {
          results.set(key, {
            status: "unavailable",
            message:
              error.name === "IntegrationError"
                ? error.message
                : "Consulta SGA indisponível.",
          });
        }
        await pool.query(
          "UPDATE zc_sga_import_tasks SET processed=$3,updated_at=now() WHERE batch_id=$1 AND run_id=$2",
          [batch.id, task.run_id, index + 1],
        );
      }
      await transaction(pool, async (db) => {
        const fresh = await d.one(
          db,
          "SELECT * FROM zc_spreadsheet_imports WHERE id=$1 FOR UPDATE",
          [batch.id],
        );
        const active = await d.one(
          db,
          "SELECT * FROM zc_sga_import_tasks WHERE batch_id=$1 FOR UPDATE",
          [batch.id],
        );
        if (active?.run_id !== task.run_id) return;
        if (
          !fresh ||
          fresh.approved_at ||
          revision({ rows: fresh.rows, mode: fresh.plan.sga_mode }) !==
            task.review_token
        ) {
          await db.query(
            "UPDATE zc_sga_import_tasks SET state='interrupted',message='A revisão mudou. Gere uma nova revisão.',updated_at=now() WHERE batch_id=$1 AND run_id=$2",
            [batch.id, task.run_id],
          );
          return;
        }
        const updated = source.map((row) =>
          batch.plan.selected_sheets.includes(row.sheet) &&
          results.has(d.vehicle(row.data?.vehicle))
            ? completeRow(
                row,
                results.get(d.vehicle(row.data.vehicle)),
                batch.plan.sga_mode,
              )
            : row,
        );
        const rows = await rebuild(
          db,
          updated,
          batch.plan.selected_sheets,
          batch.plan.archive,
        );
        const filledCount = updated.filter((r) => r.sga?.filled?.length).length,
          conflicts = updated.filter(
            (r) => r.sga?.status === "conflict",
          ).length;
        fresh.plan.source = updated;
        await db.query(
          "UPDATE zc_spreadsheet_imports SET rows=$2,plan=$3 WHERE id=$1",
          [batch.id, JSON.stringify(rows), JSON.stringify(fresh.plan)],
        );
        await db.query(
          "UPDATE zc_sga_import_tasks SET state='completed',filled=$3,conflicts=$4,review_token=$5,updated_at=now(),message='' WHERE batch_id=$1 AND run_id=$2",
          [
            batch.id,
            task.run_id,
            filledCount,
            conflicts,
            revision({ rows, mode: fresh.plan.sga_mode }),
          ],
        );
        await d.audit(
          db,
          actor,
          "sga_enriched",
          "spreadsheet_import",
          batch.id,
          { lookups: keys.length, filled: filledCount, conflicts },
        );
      });
    } catch {
      await pool
        .query(
          "UPDATE zc_sga_import_tasks SET state='failed',message='Não foi possível concluir a consulta. Gere uma nova revisão.',updated_at=now() WHERE batch_id=$1 AND run_id=$2",
          [batch.id, task.run_id],
        )
        .catch(() => {});
    } finally {
      active.delete(task.run_id);
    }
  }
  async function start(id, actor) {
    if (!client.ready()) return status(id);
    const task = await transaction(pool, async (db) => {
      const batch = await d.one(
        db,
        "SELECT * FROM zc_spreadsheet_imports WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!batch || !batch.plan.reviewed || batch.approved_at)
        fail(409, "Gere uma revisão antes de consultar o SGA.");
      const old = await d.one(
          db,
          "SELECT * FROM zc_sga_import_tasks WHERE batch_id=$1",
          [id],
        ),
        token = revision({ rows: batch.rows, mode: batch.plan.sga_mode });
      if (
        old &&
        old.review_token === token &&
        ["queued", "running", "completed"].includes(old.state) &&
        (old.state === "completed" ||
          Date.now() - new Date(old.updated_at).getTime() < 180000)
      )
        return { existing: old };
      const run = randomUUID();
      const task = await d.one(
        db,
        "INSERT INTO zc_sga_import_tasks(batch_id,run_id,review_token,state) VALUES($1,$2,$3,'queued') ON CONFLICT(batch_id) DO UPDATE SET run_id=$2,review_token=$3,state='queued',processed=0,total=0,filled=0,conflicts=0,message='',updated_at=now() RETURNING *",
        [id, run, token],
      );
      return { batch, task };
    });
    if (task.existing) return task.existing;
    active.add(task.task.run_id);
    queue = queue
      .then(() => work(task.batch, task.task, actor))
      .catch(() => {});
    return task.task;
  }
  app.get("/api/sga/status", admin, async (req, res) =>
    res.json({
      configured: client.ready(),
      read_enabled: !!(
        client.cfg.SGA_READ_ENABLED || client.cfg.INTEGRATIONS_ENABLED
      ),
      catalogs: client.catalogCache
        ? {
            fetched_at: client.catalogCache.fetched_at,
            counts: Object.fromEntries(
              Object.entries(client.catalogCache.items).map(([k, v]) => [
                k,
                v.length,
              ]),
            ),
            errors: client.catalogCache.errors,
          }
        : null,
      required: [
        "HINOVA_TOKEN_ASSOC",
        "HINOVA_USER",
        "HINOVA_PASS",
        "SGA_READ_ENABLED",
      ],
      mappings: {
        scheduled: client.cfg.SGA_SCHEDULED_CODE || "",
        completed: client.cfg.SGA_COMPLETED_CODE || "",
        photo: client.cfg.SGA_PHOTO_TYPE_CODE || "",
      },
    }),
  );
  app.post("/api/sga/catalogs/refresh", admin, async (req, res) => {
    const data = await client.catalogs(true);
    res.json({
      fetched_at: data.fetched_at,
      items: data.items,
      errors: data.errors,
    });
  });
  app.get(
    "/api/spreadsheet-imports/:id/enrichment",
    admin,
    async (req, res) => {
      if (!/^[a-f0-9-]{36}$/.test(req.params.id))
        fail(400, "Importação inválida.");
      res.json(await status(req.params.id));
    },
  );
  return { start, status };
}
module.exports = { createEnrichment, completeRow };
