// Isolated process: verify a large auxiliary sheet is drained under a small heap.
const ExcelJS = require("exceljs");
const { preview } = require("../../src/spreadsheet-import");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zen-sheet-memory-"));
  try {
    const file = path.join(root, "control.xlsx");
    const writer = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: file,
      useStyles: true,
    });
    const month = writer.addWorksheet("NOVEMBRO 2026");
    month
      .addRow([
        "",
        "SERVIÇO",
        "NOME DO ASSOCIADO",
        "PLACA / CHASSI",
        "IMEI",
        "",
        "DATA DE CONCLUSÃO",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "SITUAÇÃO",
      ])
      .commit();
    month
      .addRow([
        "",
        "Instalação",
        "Fictício",
        "ABC1D23",
        "000007260510340",
        "",
        "2026-11-02",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "CONCLUÍDO",
      ])
      .commit();
    month.commit();
    const aux = writer.addWorksheet("Ativos");
    for (let n = 0; n < 20000; n++) {
      const row = aux.addRow(
        Array.from({ length: 20 }, (_, i) => `Auxiliar ${n} coluna ${i}`),
      );
      row.eachCell((cell) => {
        cell.font = { name: "Arial", size: 11 };
      });
      row.commit();
    }
    aux.commit();
    await writer.commit();
    const rows = await preview(await fs.readFile(file));
    if (
      rows.sheets.length !== 2 ||
      rows.filter((r) => r.state === "ready").length !== 1 ||
      rows.find((r) => r.data)?.data.imei !== "000007260510340"
    )
      throw Error("Resultado inválido");
    console.log("streaming-memory-ok");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
