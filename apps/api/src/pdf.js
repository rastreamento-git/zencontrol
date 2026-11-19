const PDFDocument = require("pdfkit");
const brl = (n) =>
  (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function document(title, subtitle, sections) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      info: { Title: title, Author: "ZenControl" },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc
      .fillColor("#2563eb")
      .font("Helvetica-Bold")
      .fontSize(13)
      .text("ZENCONTROL");
    doc.moveDown(0.6).fillColor("#192b46").fontSize(24).text(title);
    doc
      .moveDown(0.3)
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#546982")
      .text(subtitle);
    doc.moveDown(1.5);
    for (const [heading, fields] of sections) {
      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .fillColor("#2563eb")
        .text(heading);
      doc.moveDown(0.6);
      for (const [label, value] of fields) {
        if (doc.y > 720) doc.addPage();
        doc
          .font("Helvetica-Bold")
          .fillColor("#192b46")
          .fontSize(10)
          .text(label);
        doc
          .moveDown(0.2)
          .font("Helvetica")
          .fillColor("#546982")
          .text(String(value || "Não informado"), { lineGap: 3 });
        doc.moveDown(0.8);
      }
      doc.moveDown(0.8);
    }
    doc.end();
  });
}
const { orderPdf } = require("./order-pdf");
function settlementPdf(p) {
  return document(
    "Fechamento de serviços",
    p.technician.name + " · " + p.start + " a " + p.end,
    [
      [
        "Serviços",
        p.orders.map((o) => [
          o.id + " · " + o.vehicle,
          o.service +
            " — " +
            brl(o.total_cents) +
            (o.executed_on ? " | Executado: " + o.executed_on : "") +
            (o.base_cents !== undefined
              ? " | Tarifa: " + brl(o.base_cents)
              : "") +
            (o.rate_id ? " | Versao: " + o.rate_id : "") +
            (o.late
              ? " | Competencia anterior: " + o.original_competence
              : "") +
            (o.extras?.length
              ? " | Adicionais: " +
                o.extras
                  .map(
                    (x) =>
                      (x.description || x.type) + " " + brl(x.amount_cents),
                  )
                  .join("; ")
              : "") +
            (o.adjustments?.length
              ? " | Ajustes: " +
                o.adjustments
                  .map((x) => x.reason + " " + brl(x.amount_cents))
                  .join("; ")
              : ""),
        ]),
      ],
      [
        "Ajustes de competencias anteriores",
        (p.carry_adjustments || []).map((a) => [
          a.order_id,
          a.reason + " — " + brl(a.amount_cents),
        ]),
      ],
      [
        "Total",
        [
          ["Valor calculado", brl(p.total_cents)],
          ["Vencimento", p.due_on || "Conforme fechamento"],
          ["Observacao", p.reason || "Valores conferidos pela central"],
        ],
      ],
    ],
  );
}
module.exports = { orderPdf, settlementPdf };
