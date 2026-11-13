const ExcelJS = require("exceljs");
const unzipper = require("unzipper");
const { createHash, randomUUID } = require("node:crypto");
const express = require("express");
const { fail } = require("./errors");
const d = require("./domain");
const { transaction } = require("./database");
const { insert } = require("./orders");
const type = "application/vnd.zencontrol.spreadsheet+json";
const digest = (x) => createHash("sha256").update(x).digest("hex");
const norm = (x) => d.normalized(String(x ?? "")).replace(/\s+/g, " ");
const months =
  /^(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO) 20\d{2}$/;
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
function date(v) {
  if (!v || v === "-") return "";
  let s = v;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) s = v.split("/").reverse().join("-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const dt = new Date(s + "T00:00:00Z");
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === s
    ? s
    : null;
}
async function preview(bytes) {
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
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(bytes);
  } catch {
    fail(400, "Não foi possível ler a planilha.");
  }
  const rows = [];
  let total = 0;
  for (const sheet of book.worksheets) {
    if (!months.test(norm(sheet.name))) {
      rows.push({
        sheet: sheet.name,
        row: 0,
        state: "ignored",
        reason: "Aba auxiliar ou não mensal; não será importada.",
      });
      continue;
    }
    const header = sheet.getRow(1);
    if (
      norm(value(header.getCell(3))) !== "NOME DO ASSOCIADO" ||
      !["PLACA / CHASSI", "PLACA/CHASSI"].includes(
        norm(value(header.getCell(4))),
      )
    ) {
      rows.push({
        sheet: sheet.name,
        row: 1,
        state: "pending",
        reason: "Cabeçalho incompatível com o controle mensal.",
      });
      continue;
    }
    if (sheet.rowCount > 20000) fail(413, "Aba com mais de 20 mil linhas.");
    for (let n = 2; n <= sheet.rowCount; n++) {
      const r = sheet.getRow(n);
      if (!r.hasValues) continue;
      if (++total > 30000)
        fail(413, "Limite de 30 mil linhas preenchidas por arquivo.");
      const v = Array.from({ length: 20 }, (_, i) => value(r.getCell(i + 1)));
      const out = {
        sheet: sheet.name,
        row: n,
        state: "ready",
        reason: "",
        raw: v,
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
      const service = services[norm(v[1])];
      if (!service) issues.push("Serviço não reconhecido");
      const states = {
        CONCLUIDO: "CONCLUÍDO",
        PENDENTE: "PENDENTE",
        AGENDADO: "AGENDADO",
        CANCELADO: "CANCELADO",
        REAGENDAR: "REAGENDAR",
      };
      const status = states[norm(v[14])];
      if (!status) issues.push("Situação exige classificação manual");
      const term = date(v[5]),
        completed = date(v[6]);
      if (term === null || completed === null) issues.push("Data inválida");
      if (status === "CONCLUÍDO" && !completed)
        issues.push("Conclusão sem data");
      if (v[4] && !/^[0-9]{8,20}$/.test(v[4]))
        issues.push("IMEI/TAG deve conter apenas dígitos");
      if (v.some((x) => x.length > 6000))
        issues.push("Conteúdo de célula excede 6000 caracteres");
      // Ambiguous P:T values are preserved with their source columns, never guessed as scheduling or SGA state.
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
        status: status || "PENDENTE",
        legacy_status: v[14],
        notes: v
          .slice(15)
          .map((x, i) => (x ? `${String.fromCharCode(80 + i)}: ${x}` : ""))
          .filter(Boolean)
          .join("\n"),
      };
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
      out.match = JSON.stringify([norm(out.data.service), norm(v[2]), vehicle]);
      if (issues.length) {
        out.state = "pending";
        out.reason = issues.join("; ");
      }
    }
  }
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
async function markExisting(db, rows) {
  const { rows: existing } = await db.query(
    "SELECT service,customer_name,vehicle FROM zc_orders",
  );
  const keys = new Set(
    existing.map((x) =>
      JSON.stringify([
        norm(x.service),
        norm(x.customer_name),
        d.vehicle(x.vehicle),
      ]),
    ),
  );
  for (const r of rows)
    if (r.state === "ready" && keys.has(r.match)) {
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
      const { filename, content } = req.body;
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
      const rows = await preview(bytes);
      await markExisting(pool, rows);
      const id = randomUUID();
      const { rows: created } = await pool.query(
        "INSERT INTO zc_spreadsheet_imports(id,filename,fingerprint,created_by,rows) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [id, filename, digest(bytes), req.user.id, JSON.stringify(rows)],
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
      req.body.confirmation !== "IMPORTAR HISTORICO" ||
      !/^[a-f0-9-]{36}$/.test(req.params.id)
    )
      fail(400, "Confirme a importação do histórico.");
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
      await db.query("LOCK TABLE zc_orders IN SHARE ROW EXCLUSIVE MODE");
      await markExisting(db, b.rows);
      let imported = 0;
      for (const r of b.rows.filter((x) => x.state === "ready")) {
        await insert(db, "zc_orders", {
          ...r.data,
          id: "XLSX-" + r.key,
          legacy_id: r.sheet + ":" + r.row,
          created_date: "",
          updated_at: d.now(),
          archive: "COLD",
          workflow_mode: "legacy",
          technician_id: null,
          raw_legacy: JSON.stringify({
            source: "spreadsheet",
            batch: b.id,
            sheet: r.sheet,
            row: r.row,
            values: r.raw,
          }),
        });
        imported++;
      }
      const result = { imported, counts: report(b).counts };
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
