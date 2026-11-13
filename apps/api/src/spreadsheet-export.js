const ExcelJS = require("exceljs");
async function exportReview(batch, res) {
  res
    .attachment("ZenControl-revisao-completa.xlsx")
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const book = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
  const summary = book.addWorksheet("Resumo");
  summary.addRow(["Nome", "Placa", "IMEI"]).commit();
  for (const row of batch.rows) {
    if (!row.data) continue;
    summary
      .addRow([
        row.data.customer_name,
        row.data.vehicle,
        row.equipment
          ?.map((e) => e.serial)
          .filter(Boolean)
          .join(" / ") || row.data.imei,
      ])
      .commit();
  }
  summary.commit();
  const mapped = book.addWorksheet("Revisão completa");
  const fields = [
    ...new Set(batch.rows.flatMap((row) => Object.keys(row.data || {}))),
  ];
  mapped
    .addRow([
      "Aba",
      "Linha",
      "Classificação",
      "Motivo",
      "Agrupamento automático",
      "IMEI adicional",
      "Origem da data de conclusão",
      ...fields,
    ])
    .commit();
  for (const row of batch.rows)
    mapped
      .addRow([
        row.sheet,
        String(row.row),
        row.state,
        row.reason || "",
        row.sources?.map((s) => s.sheet + ":" + s.row).join(" + ") || "",
        row.equipment
          ?.slice(1)
          .map((e) => e.serial)
          .filter(Boolean)
          .join(" / ") ||
          row.additional_imei ||
          "",
        row.completion_date_source === "import_date"
          ? "Data da importação"
          : "Original",
        ...fields.map((key) => {
          const val = row.data?.[key];
          return val == null
            ? ""
            : typeof val === "object"
              ? JSON.stringify(val)
              : String(val);
        }),
      ])
      .commit();
  mapped.commit();
  for (const name of batch.plan.selected_sheets) {
    // Original worksheet names are unique and valid; prefixes prevent collisions with summary sheets.
    const source = batch.plan.source.filter((row) => row.sheet === name);
    const sheet = book.addWorksheet(
      "Origem " + String(batch.plan.selected_sheets.indexOf(name) + 1),
    );
    const headers =
      batch.plan.sheets.find((s) => s.name === name)?.headers || [];
    const width = Math.max(
      headers.length,
      ...source.map((row) => row.raw?.length || 0),
    );
    sheet
      .addRow([
        "Aba original",
        "Linha original",
        ...Array.from(
          { length: width },
          (_, i) => headers[i] || "Coluna " + (i + 1),
        ),
      ])
      .commit();
    for (const row of source)
      sheet.addRow([name, String(row.row), ...(row.raw || [])]).commit();
    sheet.commit();
  }
  await book.commit();
}
module.exports = { exportReview };
