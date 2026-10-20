const PDFDocument = require("pdfkit");
const path = require("node:path");
const { orderDocument } = require("./order-document");
const color = {
  navy: "#1E293B",
  ink: "#1E293B",
  muted: "#64748B",
  line: "#CBD5E1",
  label: "#F1F5F9",
  blue: "#2563EB",
};
function orderPdf(order, masked = true, options = {}) {
  const view = orderDocument(order, masked, options);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        bufferPages: true,
        info: {
          Title: "Ordem de serviço - " + view.id,
          Author: "Zen Seguros / ZenControl",
        },
      }),
      chunks = [];
    doc.registerFont(
      "OSRegular",
      path.join(__dirname, "../assets/fonts/LiberationSans-Regular.ttf"),
    );
    doc.registerFont(
      "OSBold",
      path.join(__dirname, "../assets/fonts/LiberationSans-Bold.ttf"),
    );
    doc.on("data", (b) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = 40,
      width = doc.page.width - 80,
      bottom = 760,
      pad = 8,
      leading = 12;
    const columns = [98, (width - 196) / 2, 98, (width - 196) / 2];
    let y,
      section = "";
    const clean = (v) =>
      String(v ?? "")
        .normalize("NFC")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
        .replace(/\t/g, "    ");
    function text(
      value,
      x,
      top,
      font = "OSRegular",
      size = 8.5,
      fill = color.ink,
      extra = {},
    ) {
      doc
        .font(font)
        .fontSize(size)
        .fillColor(fill)
        .text(clean(value), x, top, { lineBreak: false, ...extra });
    }
    function header() {
      doc.image(path.join(__dirname, "../assets/zen-seguros.png"), left, 35, {
        fit: [140, 44],
      });
      text("ORDEM DE SERVIÇO", left, 43, "OSBold", 15, color.navy, {
        width,
        align: "right",
      });
      text("Atendimento técnico", left + 158, 65, "OSRegular", 8, color.muted);
      text(view.id, left, 65, "OSBold", 8, color.navy, {
        width,
        align: "right",
      });
      text(
        view.masked
          ? "Dados parcialmente ocultos. Contato e endereço destinados ao atendimento."
          : "DOCUMENTO INTEGRAL - uso restrito ao atendimento.",
        left,
        83,
        "OSRegular",
        7.3,
        view.masked ? color.muted : "#B91C1C",
      );
      doc
        .moveTo(left, 99)
        .lineTo(left + width, 99)
        .strokeColor(color.line)
        .lineWidth(0.6)
        .stroke();
      y = 112;
    }
    function sectionHeader(continued = false) {
      doc.rect(left, y, width, 23).fill(color.navy);
      text(
        section + (continued ? " (CONTINUAÇÃO)" : ""),
        left + pad,
        y + 7,
        "OSBold",
        9,
        "#FFFFFF",
        { width: width - pad * 2, align: "center" },
      );
      y += 23;
    }
    function newPage() {
      doc.addPage();
      header();
      if (section) sectionHeader(true);
    }
    function wrap(value, available, font, size) {
      doc.font(font).fontSize(size);
      const lines = [];
      for (const paragraph of clean(value || "NÃO INFORMADO").split("\n")) {
        if (!paragraph.trim()) {
          lines.push("");
          continue;
        }
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
          const candidate = line ? line + " " + word : word;
          if (doc.widthOfString(candidate) <= available) {
            line = candidate;
            continue;
          }
          if (line) {
            lines.push(line);
            line = "";
          }
          if (doc.widthOfString(word) <= available) {
            line = word;
            continue;
          }
          for (const char of word) {
            if (line && doc.widthOfString(line + char) > available) {
              lines.push(line);
              line = "";
            }
            line += char;
          }
        }
        if (line) lines.push(line);
      }
      return lines.length ? lines : [""];
    }
    function row(values, minHeight = 31) {
      let column = 0;
      const cells = values.map((cell) => {
        if (typeof cell === "string") cell = { value: cell };
        const span = cell.span || 1,
          w = columns.slice(column, column + span).reduce((a, b) => a + b, 0);
        column += span;
        const label = !!cell.label,
          font = label ? "OSBold" : "OSRegular",
          size = label ? 7.3 : 8.5;
        return {
          ...cell,
          w,
          font,
          size,
          lines: wrap(cell.value, w - pad * 2, font, size),
        };
      });
      const total = Math.max(...cells.map((c) => c.lines.length));
      let offset = 0;
      while (offset < total) {
        let fits = Math.floor((bottom - y - pad * 2) / leading);
        if (
          fits < 1 ||
          bottom - y < Math.min(minHeight, pad * 2 + total * leading)
        ) {
          newPage();
          fits = Math.floor((bottom - y - pad * 2) / leading);
        }
        const take = Math.min(total - offset, fits),
          height = Math.max(
            offset === 0 ? minHeight : 0,
            take * leading + pad * 2,
          );
        let x = left;
        for (const cell of cells) {
          doc
            .rect(x, y, cell.w, height)
            .fillAndStroke(cell.label ? color.label : "#FFFFFF", color.line);
          for (let i = 0; i < take; i++) {
            const line = cell.lines[offset + i];
            if (line !== undefined)
              text(line, x + pad, y + pad + i * leading, cell.font, cell.size);
          }
          x += cell.w;
        }
        y += height;
        offset += take;
        if (offset < total) newPage();
      }
    }
    function table(title, rows, minHeight = 31) {
      section = title;
      if (y + 23 + minHeight > bottom) {
        doc.addPage();
        header();
      }
      sectionHeader();
      for (const cells of rows) row(cells, minHeight);
      section = "";
      y += 12;
    }
    const label = (value) => ({ value, label: true }),
      value = (v, span) => ({ value: v || "NÃO INFORMADO", span });
    header();
    table("DADOS DO ASSOCIADO", [
      [
        label("NOME COMPLETO"),
        value(view.customer.name),
        label("CONTATO"),
        value(view.customer.contact),
      ],
      [
        label("CPF / CNPJ"),
        value(view.customer.document),
        label("RG"),
        value(view.customer.rg),
      ],
      [label("ENDEREÇO"), value(view.customer.address, 3)],
    ]);
    table("INFORMAÇÕES DO VEÍCULO", [
      [
        label("PLACA"),
        value(view.vehicle.plate),
        label("RENAVAM"),
        value(view.vehicle.renavam),
      ],
      [label("CHASSI"), value(view.vehicle.chassis, 3)],
      [
        label("MARCA / MODELO"),
        value(
          [view.vehicle.brand, view.vehicle.model].filter(Boolean).join(" / "),
        ),
        label("ANO"),
        value(view.vehicle.year),
      ],
      [
        label("CATEGORIA / TIPO"),
        value(
          [view.vehicle.category, view.vehicle.type]
            .filter(Boolean)
            .join(" / "),
        ),
        label("FIPE"),
        value(view.vehicle.fipe),
      ],
    ]);
    const attendance = [
      [label("SERVIÇO"), value(view.service, 3)],
      [
        label("TÉCNICO RESP."),
        value(view.technician),
        label("AGENDAMENTO"),
        value(view.appointment),
      ],
    ];
    if (view.location)
      attendance.push([label("LOCAL DO SERVIÇO"), value(view.location, 3)]);
    table("DETALHES DO ATENDIMENTO", attendance);
    table(
      "INSTRUÇÕES / OBSERVAÇÕES GERAIS",
      [[value(view.instructions, 4)]],
      100,
    );
    section = "RETORNO DO ATENDIMENTO";
    if (y + 58 > bottom) {
      doc.addPage();
      header();
    }
    text("RETORNO DO ATENDIMENTO", left, y, "OSBold", 8, color.blue);
    y += 16;
    section = "";
    row([value(view.returnInstructions, 4)]);
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const previous = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .moveTo(left, 785)
        .lineTo(left + width, 785)
        .strokeColor(color.line)
        .lineWidth(0.5)
        .stroke();
      text(
        "ZenControl - Desenvolvido por Victor Rodrigues",
        left,
        796,
        "OSRegular",
        7,
        color.muted,
      );
      text(
        `Página ${i + 1} de ${range.count}`,
        left,
        796,
        "OSRegular",
        7,
        color.muted,
        { width, align: "right" },
      );
      if (view.draft)
        text(
          "Agendamento ou técnico pendente de definição",
          left,
          811,
          "OSRegular",
          7,
          color.muted,
        );
      doc.page.margins.bottom = previous;
    }
    doc.end();
  });
}
module.exports = { orderPdf };
