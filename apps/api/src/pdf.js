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
function orderPdf(o, masked = true) {
  const parts = o.customer_name.split(/\s+/);
  const name = masked
    ? parts[0] +
      " " +
      parts
        .slice(1)
        .map((p) => p[0] + ".")
        .join(" ")
    : o.customer_name;
  return document("Ordem de serviço", o.id, [
    [
      "Atendimento",
      [
        ["Serviço", o.service],
        ["Placa ou chassi", o.vehicle],
        ["Chassi", o.chassis],
        ["Técnico", o.technician_name],
        ["Agendamento", o.scheduled_at.replace("T", " ")],
        ["Associado", name],
        ["Contato", o.contact],
        ["Local", o.location],
        ["Observações", o.notes],
      ],
    ],
    [
      "Retorno",
      [
        [
          "Instruções",
          `Encaminhe OS: ${o.id}, Placa ou Chassi: ${o.vehicle}, as fotos e os comentários. Finalize com . ou #.# para o hub.`,
        ],
        [
          "Privacidade",
          masked
            ? "Nome abreviado. Contato e local são necessários ao atendimento."
            : "Documento integral: compartilhe somente com o técnico responsável.",
        ],
      ],
    ],
  ]);
}
function settlementPdf(p) {
  return document(
    "Fechamento de serviços",
    p.technician.name + " · " + p.start + " a " + p.end,
    [
      [
        "Serviços",
        p.orders.map((o) => [
          o.id + " · " + o.vehicle,
          o.service + " — " + brl(o.total_cents),
        ]),
      ],
      ["Total", [["Valor calculado", brl(p.total_cents)]]],
    ],
  );
}
module.exports = { orderPdf, settlementPdf };
