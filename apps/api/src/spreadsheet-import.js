const ExcelJS = require("exceljs");
const { Readable } = require("node:stream");
const unzipper = require("unzipper");
const { createHash, randomUUID } = require("node:crypto");
const express = require("express");
const { exportReview } = require("./spreadsheet-export");
const { groupRows } = require("./spreadsheet-grouping");
const layout = require("./spreadsheet-structure");
const { fail } = require("./errors");
const d = require("./domain");
const { transaction } = require("./database");
const { insert } = require("./orders");
const type = "application/vnd.zencontrol.spreadsheet+json";
const digest = (x) => createHash("sha256").update(x).digest("hex");
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, stable(value[k])]),
        )
      : value;
const revision = (rows) => digest(JSON.stringify(stable(rows)));
const norm = (x) => d.normalized(String(x ?? "")).replace(/\s+/g, " ");
function value(cell) {
  let v = cell.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("formula" in v || "sharedFormula" in v) v = v.result ?? "";
    else if (v.richText) v = v.richText.map((x) => x.text).join("");
    else if (v.error) v = v.error;
    else v = v.text ?? "";
  }
  if (v instanceof Date)
    return Number.isNaN(v.getTime())
      ? "#DATA_INVALIDA"
      : v.toISOString().slice(0, 10);
  return String(v ?? "").trim();
}
async function preview(bytes, today = d.today(), deduplicate = true) {
  if (bytes.length > 10 * 1024 * 1024)
    fail(413, "Escolha uma planilha de até 10 MB.");
  let zip;
  try {
    zip = await unzipper.Open.buffer(bytes);
  } catch {
    fail(400, "Arquivo XLSX inválido.");
  }
  if (
    zip.files.length > 3000 ||
    zip.files.reduce((n, f) => n + f.uncompressedSize, 0) > 80 * 1024 * 1024
  )
    fail(413, "Planilha excede o limite de leitura.");
  if (!zip.files.some((f) => f.path === "xl/workbook.xml"))
    fail(400, "Envie um arquivo XLSX.");
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(
    Readable.from([bytes]),
    {
      worksheets: "emit",
      sharedStrings: "cache",
      styles: "cache",
      hyperlinks: "ignore",
    },
  );
  const rows = [],
    sheets = [];
  Object.defineProperty(rows, "sheets", { value: sheets });
  let total = 0;
  for await (const sheet of reader) {
    const month = layout.period(sheet.name);
    const descriptor = {
      name: sheet.name,
      period: month,
      rows: 0,
      eligible: !!month,
    };
    sheets.push(descriptor);
    if (!month) {
      rows.push({
        sheet: sheet.name,
        row: 0,
        state: "ignored",
        reason: "Aba auxiliar ou não mensal; não será importada.",
      });
      for await (const ignored of sheet) {
        /* Drain without retaining auxiliary rows. */
      }
      continue;
    }
    let schema = null;
    for await (const r of sheet) {
      const n = r.number;
      if (n > 20000) fail(413, "Aba com mais de 20 mil linhas.");
      if (!schema) {
        if (n <= 30) {
          const found = layout.structure(
            { rowCount: 1, columnCount: 64, getRow: () => r },
            value,
          );
          if (found) {
            schema = { ...found, headerRow: n };
            descriptor.headers = Array.from({ length: 64 }, (_, i) =>
              value(r.getCell(i + 1)),
            );
          }
        }
        continue;
      }
      if (!r.hasValues) continue;
      if (++total > 30000)
        fail(413, "Limite de 30 mil linhas preenchidas por arquivo.");
      const raw = Array.from(
        { length: Math.max(20, Math.min(r.cellCount, 64)) },
        (_, i) => value(r.getCell(i + 1)),
      );
      const v = schema.columns.map((c) => (c ? value(r.getCell(c)) : ""));
      v.push(...schema.notes.map((c) => value(r.getCell(c))));
      // Repeated header rows are separators, not appointments.
      if (norm(v[2]) === "NOME DO ASSOCIADO" && norm(v[1]).startsWith("SERVIC"))
        continue;
      const out = {
        sheet: sheet.name,
        row: n,
        state: "ready",
        reason: "",
        raw,
        period: month,
        parser_version: 2,
        source_service: v[1],
      };
      rows.push(out);
      const control = /^(VERIFICADO ATE AQUI|FECHAMENTO|TOTAL|SUBTOTAL)(\b|:)/;
      const vehicle = d.vehicle(v[3]);
      const validVehicle =
        /^(?:[A-Z]{3}\d[A-Z0-9]\d{2}|[A-HJ-NPR-Z0-9]{17})$/.test(vehicle);
      if (
        (!v[2] && !v[3] && !v[1] && !v[4] && !v[5] && !v[6]) ||
        (!validVehicle && v.some((x) => control.test(norm(x))))
      ) {
        out.state = "ignored";
        out.reason =
          "Linha de controle, total, separador ou nome de técnico sem atendimento.";
        continue;
      }
      const issues = [];
      if (!v[2] || !validVehicle)
        issues.push("Nome e placa/chassi válidos são obrigatórios");
      if (v.some((x) => /^#(REF!|VALUE!|N\/A|DATA_INVALIDA|NUM!)/.test(x)))
        issues.push("Célula com erro ou formato de data inválido");
      const services = {
        INSTALACAO: "Instalação",
        MANUTENCAO: "Manutenção",
        RETIRADA: "Retirada",
        REINSTALACAO: "Reinstalação",
        IMPRODUTIVA: "Improdutiva",
        "VISITA TECNICA": "Visita",
        TAG: "TAG",
        "DUAS TAGS": "Duas TAGs",
        "INSTALACAO+TAG": "Instalação + TAG",
        "INSTALACAO + TAG": "Instalação + TAG",
        "INSTALACAO+BLOQUEIO": "Instalação + Bloqueio",
        "INSTALACAO + BLOQUEIO": "Instalação + Bloqueio",
        BLOQUEIO: "Bloqueio",
      };
      let service = services[norm(v[1])];
      if (!service) issues.push("Serviço não reconhecido");
      const term = layout.parseDate(v[5], month),
        completed = layout.parseDate(v[6], month);
      if (term === null || completed === null) issues.push("Data inválida");
      let scheduled = schema.scheduled
        ? layout.parseDate(value(r.getCell(schema.scheduled)), month)
        : "";
      let shift = schema.shift ? value(r.getCell(schema.shift)) : "";
      // The supplied monthly layout uses P/Q as date + shift. A lone observation date is not enough.
      if (
        !schema.scheduled &&
        schema.original &&
        /^(MANHA|TARDE|NOITE|INTEGRAL|COMERCIAL)$/.test(
          norm(value(r.getCell(17))),
        )
      ) {
        scheduled = layout.parseDate(value(r.getCell(16)), month);
        shift = value(r.getCell(17));
      }
      if (scheduled === null) issues.push("Data de agendamento inválida");
      const inferred = layout.infer({
        status: v[14],
        completed,
        scheduled,
        month,
        today,
      });
      issues.push(...inferred.issues);
      out.inference = inferred.reasons;
      out.destination = inferred.terminal ? "Encerrados" : "Operação";
      let equipment = null;
      if (!inferred.terminal) {
        equipment =
          {
            TAG: { tracker: 0, tag: 1 },
            "Duas TAGs": { tracker: 0, tag: 2 },
            "Instalação + TAG": { tracker: 1, tag: 1 },
          }[service] || null;
        if (equipment) {
          service = "Instalação";
          out.inference.push(
            `Serviço de origem ${v[1]}: ${equipment.tracker} rastreador(es) e ${equipment.tag} TAG(s)`,
          );
        } else if (["Instalação", "Reinstalação"].includes(service))
          equipment = { tracker: 1, tag: 0 };
        if (service && !d.services.includes(service))
          issues.push(
            "Serviço de bloqueio exige revisão no módulo de bloqueios",
          );
      }
      if (v[4] && !/^[0-9]{8,20}$/.test(v[4]))
        issues.push("IMEI/TAG deve conter apenas dígitos");
      if (v.some((x) => x.length > 6000))
        issues.push("Conteúdo de célula excede 6000 caracteres");
      // Preserve observation values even when a date/shift pair also informs scheduling.
      out.data = {
        service: service || v[1],
        customer_name: v[2],
        vehicle,
        chassis: vehicle.length === 17 ? vehicle : "",
        imei: v[4],
        term: term || "",
        completed_at: completed || "",
        technician_name: v[7],
        location: v[8],
        volunteer: v[9],
        fipe_value: v[10],
        fipe_risk: v[11],
        created_by: v[12],
        closed_by: v[13],
        status: inferred.status,
        archive: inferred.archive,
        workflow_mode: inferred.workflow_mode,
        scheduled_at: scheduled || "",
        shift,
        technician_id: null,
        legacy_status: v[14],
        notes: v
          .slice(15)
          .map((x, i) =>
            x
              ? `${r.getCell(schema.notes[i]).address.replace(/\d+$/, "")}: ${x}`
              : "",
          )
          .filter(Boolean)
          .join("\n"),
      };
      if (equipment) {
        out.data.document_data = {
          equipment_counts: equipment,
          equipment: [equipment.tracker ? "tracker" : "tag"],
        };
        out.additional_orders = Math.max(
          0,
          equipment.tracker + equipment.tag - 1,
        );
      }
      if (inferred.status === "CONCLUÍDO" && completed === "") {
        out.completion_date_source = "import_date";
        out.data.completed_at = today;
        out.data.document_data = {
          ...out.data.document_data,
          completion_date_source: "import_date",
        };
        out.inference.push(
          "Data de conclusão não informada: será usada a data da importação, com indicador de origem.",
        );
      }
      descriptor.rows++;
      out.key = digest(
        JSON.stringify([
          norm(v[1]),
          norm(v[2]),
          vehicle,
          v[4],
          term,
          completed,
        ]),
      );
      out.match = JSON.stringify([norm(v[2]), vehicle]);
      if (issues.length) {
        out.state = "pending";
        out.reason = issues.join("; ");
      }
    }
    if (!schema)
      rows.push({
        sheet: sheet.name,
        row: 0,
        state: "pending",
        reason:
          "Não foi possível identificar cabeçalhos nas primeiras 30 linhas.",
      });
  }
  if (!deduplicate) return rows;
  const seen = new Map();
  for (const r of rows.filter((r) => r.state === "ready")) {
    const previous = seen.get(r.match);
    if (previous) {
      r.state = "duplicate";
      r.reason =
        "Possível repetição no arquivo; conferir as linhas antes de importar.";
      previous.state = "duplicate";
      previous.reason = r.reason;
    } else seen.set(r.match, r);
  }
  return rows;
}
async function resolveTechnicians(db, rows) {
  const technicians = (
    await db.query("SELECT id,name FROM zc_technicians WHERE active=true")
  ).rows;
  for (const r of rows) {
    if (r.state !== "ready" || r.data.workflow_mode !== "controlled") continue;
    const matches = technicians.filter(
      (t) => norm(t.name) === norm(r.data.technician_name),
    );
    r.data.technician_id = matches.length === 1 ? matches[0].id : null;
    if (matches.length === 1)
      r.inference.push(
        "Técnico vinculado por nome exato e único no cadastro ativo",
      );
    else if (["AGENDADO", "EM EXECUÇÃO"].includes(r.data.status)) {
      r.state = "pending";
      r.reason =
        "Agendamento exige técnico ativo identificado sem ambiguidade; revise o cadastro e gere nova prévia";
    } else
      r.inference.push(
        "Sem vínculo automático de técnico; a operação deverá atribuir o responsável",
      );
  }
}
async function markExisting(db, rows) {
  const { rows: existing } = await db.query(
    "SELECT id,service,customer_name,vehicle FROM zc_orders",
  );
  const ids = new Set(existing.map((x) => x.id));
  const keys = new Set(
    existing.map((x) =>
      JSON.stringify([norm(x.customer_name), d.vehicle(x.vehicle)]),
    ),
  );
  for (const r of rows)
    if (
      r.state === "ready" &&
      (ids.has("XLSX-" + r.key) ||
        r.sources?.some((s) => ids.has("XLSX-" + s.key)) ||
        keys.has(r.match))
    ) {
      r.state = "duplicate";
      r.reason =
        "Atendimento semelhante já existe no ZenControl; nenhuma atualização automática.";
    }
}
function report(batch) {
  const counts = { ready: 0, ignored: 0, pending: 0, duplicate: 0 };
  for (const r of batch.rows) counts[r.state]++;
  return {
    id: batch.id,
    filename: batch.filename,
    created_at: batch.created_at,
    expires_at: batch.expires_at,
    approved_at: batch.approved_at,
    result: batch.result,
    counts,
    review_token: revision(batch.rows),
    reviewed: batch.plan?.version === 6 && !!batch.plan?.reviewed,
    selected_sheets: batch.plan?.selected_sheets || [],
    sheets: batch.plan?.sheets || [],
    groups: batch.plan?.groups || [],
    archive: batch.plan?.archive || "",
    rows: batch.rows.map(({ raw, key, match, ...r }) => r),
  };
}
function configureSpreadsheetImport(app, pool, auth) {
  const admin = (req, res, next) => {
    if (req.user?.papel !== "admin")
      fail(403, "Somente um administrador pode importar planilhas.");
    next();
  };
  app.post(
    "/api/spreadsheet-imports",
    admin,
    express.json({ type, limit: "15mb" }),
    async (req, res) => {
      const { filename, content } = req.body || {};
      if (
        typeof filename !== "string" ||
        filename.length > 200 ||
        !filename.toLowerCase().endsWith(".xlsx") ||
        typeof content !== "string" ||
        content.length > 14 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(content)
      )
        fail(400, "Selecione uma planilha XLSX de até 10 MB.");
      const bytes = Buffer.from(content, "base64");
      const source = await preview(bytes, d.today(), false);
      const sheets = source.sheets;
      const plan = {
        source,
        sheets,
        selected_sheets: [],
        reviewed: false,
        groups: [],
        version: 6,
      };
      const rows = [];
      const id = randomUUID();
      const { rows: created } = await pool.query(
        "INSERT INTO zc_spreadsheet_imports(id,filename,fingerprint,created_by,rows,plan) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          id,
          filename,
          digest(bytes),
          req.user.id,
          JSON.stringify(rows),
          JSON.stringify(plan),
        ],
      );
      await d.audit(
        pool,
        req.user.login,
        "spreadsheet_preview",
        "spreadsheet_import",
        id,
        { filename },
      );
      res.status(201).json(report(created[0]));
    },
  );
  app.get("/api/spreadsheet-imports", admin, async (req, res) =>
    res.json({
      items: (
        await pool.query(
          "SELECT id,filename,created_at,approved_at,result FROM zc_spreadsheet_imports ORDER BY created_at DESC LIMIT 30",
        )
      ).rows,
    }),
  );
  app.get("/api/spreadsheet-imports/capabilities", admin, (req, res) =>
    res.json({
      version: 6,
      sheet_selection: true,
      manual_equipment_grouping: true,
      admin_archive: true,
      full_export: true,
    }),
  );
  app.post("/api/spreadsheet-imports/:id/review", admin, async (req, res) => {
    if (!/^[a-f0-9-]{36}$/.test(req.params.id))
      fail(400, "Importação inválida.");
    const result = await transaction(pool, async (db) => {
      const b = await d.one(
        db,
        "SELECT * FROM zc_spreadsheet_imports WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!b) fail(404, "Importação não encontrada.");
      if (b.approved_at || new Date(b.expires_at) < new Date())
        fail(409, "Lote confirmado ou expirado. Envie novamente.");
      if (b.plan?.version !== 6)
        fail(409, "Gere uma nova prévia para escolher as abas.");
      const selected = req.body?.sheets;
      if (
        !Array.isArray(selected) ||
        !selected.length ||
        new Set(selected).size !== selected.length ||
        selected.some(
          (name) => !b.plan.sheets.some((s) => s.name === name && s.eligible),
        )
      )
        fail(400, "Escolha uma ou mais abas mensais válidas.");
      if (req.body.group_equipment)
        fail(
          400,
          "O agrupamento deve ser manual. Selecione cada par de linhas.",
        );
      const archive = req.body.archive;
      if (!["HOT", "WARM", "COLD"].includes(archive))
        fail(400, "Escolha a base de destino: HOT, WARM ou COLD.");
      const groups = req.body.groups || [];
      const rows = groupRows(
        b.plan.source.filter((r) => selected.includes(r.sheet)),
        groups,
      );
      for (const row of rows)
        if (row.data) {
          row.data.archive = archive;
          row.inference.push("Base escolhida pelo administrador: " + archive);
        }
      await resolveTechnicians(db, rows);
      await markExisting(db, rows);
      b.rows = rows;
      b.plan = {
        ...b.plan,
        selected_sheets: selected,
        reviewed: true,
        archive,
        groups,
      };
      await db.query(
        "UPDATE zc_spreadsheet_imports SET rows=$2,plan=$3 WHERE id=$1",
        [b.id, JSON.stringify(rows), JSON.stringify(b.plan)],
      );
      return report(b);
    });
    res.json(result);
  });
  app.get("/api/spreadsheet-imports/:id/export", admin, async (req, res) => {
    if (!/^[a-f0-9-]{36}$/.test(req.params.id))
      fail(400, "Importação inválida.");
    const batch = await d.one(
      pool,
      "SELECT * FROM zc_spreadsheet_imports WHERE id=$1",
      [req.params.id],
    );
    if (!batch) fail(404, "Importação não encontrada.");
    if (!batch.plan?.reviewed || batch.plan.version !== 6)
      fail(409, "Escolha as abas e a base para gerar a revisão completa.");
    await exportReview(batch, res);
  });
  app.get("/api/spreadsheet-imports/:id", admin, async (req, res) => {
    if (!/^[a-f0-9-]{36}$/.test(req.params.id))
      fail(400, "Importação inválida.");
    const b = await d.one(
      pool,
      "SELECT * FROM zc_spreadsheet_imports WHERE id=$1",
      [req.params.id],
    );
    if (!b) fail(404, "Importação não encontrada.");
    res.json(report(b));
  });
  app.post("/api/spreadsheet-imports/:id/approve", admin, async (req, res) => {
    if (
      req.body?.confirmation !== "IMPORTAR SERVICOS" ||
      !/^[a-f0-9-]{36}$/.test(req.params.id)
    )
      fail(400, "Confirme a importação dos serviços.");
    const result = await transaction(pool, async (db) => {
      const b = await d.one(
        db,
        "SELECT * FROM zc_spreadsheet_imports WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!b) fail(404, "Importação não encontrada.");
      if (b.approved_at) return b.result;
      if (new Date(b.expires_at) < new Date())
        fail(409, "Prévia expirada. Envie a planilha novamente.");
      if (
        !b.plan?.reviewed ||
        b.plan.version !== 6 ||
        !["HOT", "WARM", "COLD"].includes(b.plan.archive)
      )
        fail(
          409,
          "Escolha as abas e gere a prévia de revisão antes de importar.",
        );
      if (req.body.review_token !== revision(b.rows))
        fail(409, "A prévia mudou. Atualize e revise antes de confirmar.");
      await db.query("LOCK TABLE zc_orders IN SHARE ROW EXCLUSIVE MODE");
      if (b.rows.some((r) => r.data && r.parser_version !== 2))
        fail(
          409,
          "Prévia de versão anterior. Envie o arquivo novamente para identificar as etapas.",
        );
      const before = JSON.stringify(
        b.rows.map((r) => [r.state, r.data?.technician_id]),
      );
      await resolveTechnicians(db, b.rows);
      if (
        before !==
        JSON.stringify(b.rows.map((r) => [r.state, r.data?.technician_id]))
      )
        fail(
          409,
          "Cadastro de técnicos mudou. Gere nova prévia antes de confirmar.",
        );
      await markExisting(db, b.rows);
      let imported = 0,
        additional = 0;
      for (const r of b.rows.filter((x) => x.state === "ready")) {
        if (r.completion_date_source === "import_date")
          r.data.completed_at = d.today();
        const saved = await insert(db, "zc_orders", {
          ...r.data,
          ...(r.data.document_data
            ? { document_data: JSON.stringify(r.data.document_data) }
            : {}),
          id: "XLSX-" + r.key,
          legacy_id: r.sheet + ":" + r.row,
          created_date: "",
          updated_at: d.now(),

          raw_legacy: JSON.stringify({
            source: "spreadsheet",
            batch: b.id,
            sheet: r.sheet,
            row: r.row,
            values: r.raw,
            sources: r.sources || [
              { sheet: r.sheet, row: r.row, key: r.key, values: r.raw },
            ],
            period: r.period,
            inference: r.inference,
            parser_version: 2,
            source_service: r.source_service,
            completion_date_source: r.completion_date_source || "original",
          }),
        });
        const counts = r.data.document_data?.equipment_counts;
        if (counts) {
          const types = (
            r.equipment?.map((e) => e.type) || [
              ...Array(counts.tracker).fill("RASTREADOR"),
              ...Array(counts.tag).fill("TAG"),
            ]
          ).slice(1);
          for (const [index, equipmentType] of types.entries()) {
            await insert(db, "zc_orders", {
              ...r.data,
              id: saved.id + "_EXTRA_" + (index + 1),
              parent_order_id: saved.id,
              additional_equipment: equipmentType,
              service: r.data.service + " (Equipamento adicional)",
              imei: r.equipment?.[index + 1]?.serial || "",
              completed_at:
                r.data.status === "CONCLUÍDO" &&
                r.equipment?.[index + 1]?.completion_date_source ===
                  "import_date"
                  ? d.today()
                  : r.data.completed_at,
              legacy_id: saved.legacy_id,
              created_date: "",
              updated_at: d.now(),
              document_data: JSON.stringify({
                ...(r.data.status === "CONCLUÍDO" &&
                r.equipment?.[index + 1]?.completion_date_source ===
                  "import_date"
                  ? { completion_date_source: "import_date" }
                  : {}),
                ...(r.data.document_data?.completion_date_source
                  ? {
                      completion_date_source:
                        r.data.document_data.completion_date_source,
                    }
                  : {}),
                equipment_counts: {
                  tracker: equipmentType === "RASTREADOR" ? 1 : 0,
                  tag: equipmentType === "TAG" ? 1 : 0,
                },
                equipment: [equipmentType === "TAG" ? "tag" : "tracker"],
              }),
              raw_legacy: JSON.stringify({
                ...saved.raw_legacy,
                parent_id: saved.id,
                completion_date_source:
                  r.equipment?.[index + 1]?.completion_date_source ===
                  "import_date"
                    ? "import_date"
                    : saved.raw_legacy.completion_date_source,
              }),
            });
            additional++;
          }
        }
        imported++;
      }
      const result = {
        imported,
        additional_orders: additional,
        counts: report(b).counts,
      };
      await db.query(
        "UPDATE zc_spreadsheet_imports SET approved_by=$2,approved_at=now(),result=$3,rows=$4 WHERE id=$1",
        [b.id, req.user.id, JSON.stringify(result), JSON.stringify(b.rows)],
      );
      await d.audit(
        db,
        req.user.login,
        "spreadsheet_approved",
        "spreadsheet_import",
        b.id,
        { ...result, admin_id: req.user.id },
      );
      return result;
    });
    res.json(result);
  });
}
module.exports = { preview, configureSpreadsheetImport, type };
