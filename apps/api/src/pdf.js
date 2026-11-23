const PDFDocument = require("pdfkit");
const path = require("node:path");
const { orderPdf } = require("./order-pdf");

const assets = path.join(__dirname, "../assets");
const palette = {
  blue: "#195CCD",
  ink: "#13233C",
  muted: "#4E627D",
  line: "#D5E0EE",
  background: "#F2F6FC",
};
const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const brl = (cents) => currency.format(cents / 100);
const dateLabel = (value) => {
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return date ? date.slice(1).reverse().join("/") : "—";
};
const monthLabel = (value) => {
  const month = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  return month ? month.slice(1).reverse().join("/") : "";
};
const clean = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const closingStates = {
  draft: "Em conferência",
  legacy_unverified: "Histórico a conferir",
  approved: "Aguardando pagamento",
  awaiting_payment: "Aguardando pagamento",
  partial: "Pagamento parcial",
  paid: "Quitado",
  no_payment_due: "Sem valor a pagar",
  cancelled: "Cancelado",
};

function detailParts(value) {
  return clean(value).match(/.{1,320}(?: |$)|.{1,320}/gu) || [""];
}

function settlementPdf(snapshot, state) {
  return new Promise((resolve, reject) => {
    const title = "Fechamento de serviços";
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      bufferPages: true,
      info: { Title: title, Author: "Zen Seguros" },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont(
      "Regular",
      path.join(assets, "fonts/LiberationSans-Regular.ttf"),
    );
    doc.registerFont(
      "Bold",
      path.join(assets, "fonts/LiberationSans-Bold.ttf"),
    );

    const left = 42;
    const right = doc.page.width - left;
    const width = right - left;
    const bottom = doc.page.height - 64;
    const valueWidth = 105;
    const valueX = right - valueWidth - 12;
    const period = dateLabel(snapshot.start) + " a " + dateLabel(snapshot.end);
    const name = clean(snapshot.technician.name);
    const orders = snapshot.orders;
    const carry = snapshot.carry_adjustments || [];
    let y;
    let section;
    let columns;

    function text(value, x, top, options = {}) {
      const {
        size = 10,
        color = palette.ink,
        bold = false,
        ...layout
      } = options;
      doc
        .font(bold ? "Bold" : "Regular")
        .fontSize(size)
        .fillColor(color)
        .text(clean(value), x, top, layout);
    }

    function line(top) {
      doc
        .moveTo(left, top)
        .lineTo(right, top)
        .lineWidth(0.6)
        .strokeColor(palette.line)
        .stroke();
    }

    function header(first) {
      doc.image(path.join(assets, "zen-seguros.png"), left, 39, { width: 125 });
      if (first) {
        y = 100;
        text(title, left, y, { size: 27, bold: true, width });
        y = doc.y + 18;
        text("TÉCNICO", left, y, {
          size: 8,
          bold: true,
          color: palette.muted,
          width,
        });
        text(name, left, doc.y + 4, { size: 14, bold: true, width });
        if (state) {
          text(closingStates[state] || "Situação não informada", left, doc.y + 4, {
            bold: true, color: palette.blue, width,
          });
        }
        y = doc.y + 15;

        doc.roundedRect(left, y, width, 76, 8).fill(palette.background);
        const summary = [
          ["PERÍODO", period],
          [
            "VENCIMENTO",
            snapshot.due_on ? dateLabel(snapshot.due_on) : "Não informado",
          ],
          ["TOTAL DO FECHAMENTO", brl(snapshot.total_cents)],
        ];
        const starts = [left + 14, left + 190, left + 307];
        const widths = [165, 110, width - 321];
        summary.forEach(([label, value], index) => {
          const total = index === 2;
          const placement = {
            width: widths[index],
            align: total ? "right" : "left",
          };
          text(label, starts[index], y + 16, {
            ...placement,
            bold: true,
            size: 8,
            color: palette.muted,
          });
          text(value, starts[index], y + (total ? 32 : 38), {
            ...placement,
            bold: true,
            size: total ? 21 : 12,
            color: total ? palette.blue : palette.ink,
          });
        });
        y += 100;
      } else {
        text(title, left + 150, 42, {
          bold: true,
          size: 14,
          width: width - 150,
          align: "right",
        });
        text(period, left + 150, 62, {
          color: palette.muted,
          width: width - 150,
          align: "right",
        });
        line(92);
        y = 108;
      }
    }

    function sectionHeader(continued = false) {
      text(section + (continued ? " (continuação)" : ""), left, y, {
        size: 14,
        bold: true,
        color: palette.blue,
        width,
      });
      y = doc.y + 8;
      doc.rect(left, y, width, 25).fill(palette.background);
      for (const { label, x, width, align } of columns) {
        text(label, x, y + 7, {
          width,
          align,
          size: 8,
          bold: true,
          color: palette.muted,
        });
      }
      y += 25;
    }

    function startSection(title, nextColumns, firstRowHeight = 66) {
      section = title;
      columns = nextColumns;
      if (y + 52 + firstRowHeight > bottom) {
        doc.addPage();
        header(false);
      }
      sectionHeader();
    }

    function ensureRoom(height) {
      if (y + height <= bottom) return false;
      doc.addPage();
      header(false);
      sectionHeader(true);
      return true;
    }

    function heightOf(value, width, size = 9) {
      return doc
        .font("Regular")
        .fontSize(size)
        .heightOfString(clean(value), { width });
    }

    const os = { label: "ORDEM / VEÍCULO", x: left + 12, width: 104 };
    const service = { label: "SERVIÇO", x: left + 126, width: 157 };
    const execution = { label: "EXECUÇÃO", x: left + 291, width: 90 };
    const amount = {
      label: "VALOR TOTAL",
      x: valueX,
      width: valueWidth,
      align: "right",
    };
    const detailWidth = valueX - service.x - 10;
    const noteOptions = { size: 9, color: palette.muted };
    const currencyOptions = { width: valueWidth, align: "right" };

    header(true);
    if (orders.length) {
      startSection("Serviços realizados", [os, service, execution, amount]);
      for (const order of orders) {
        const serviceHeight = heightOf(order.service, service.width, 10);
        const late = order.late
          ? ["Competência original", monthLabel(order.original_competence)]
              .filter(Boolean)
              .join(" · ")
          : "";
        const rowHeight = Math.max(29, serviceHeight + (late ? 14 : 0)) + 15;
        const extras = order.extras || [];
        const adjustments = order.adjustments || [];
        const details = [
          ...(order.base_cents != null &&
          (extras.length ||
            adjustments.length ||
            order.base_cents !== order.total_cents)
            ? [["Tarifa do serviço", order.base_cents]]
            : []),
          ...extras.map((extra) => [
            "Adicional · " +
              (extra.description || extra.type || "Sem descrição"),
            extra.amount_cents,
          ]),
          ...adjustments.map((adjustment) => [
            "Ajuste · " + (adjustment.reason || "Sem descrição"),
            adjustment.amount_cents,
          ]),
        ].flatMap(([label, cents]) =>
          detailParts(label).map((part, index) => [part, index ? null : cents]),
        );
        const firstDetailHeight = details.length
          ? Math.max(12, heightOf(details[0][0], detailWidth)) + 7
          : 0;
        ensureRoom(rowHeight + firstDetailHeight);
        text(order.id, os.x, y + 8, { width: os.width, bold: true });
        text(order.vehicle || "—", os.x, doc.y + 2, {
          ...noteOptions,
          width: os.width,
        });
        text(order.service, service.x, y + 8, { width: service.width });
        if (late)
          text(late, service.x, doc.y + 2, {
            ...noteOptions,
            width: service.width,
          });
        text(
          dateLabel(order.executed_on || order.completed_at),
          execution.x,
          y + 8,
          { width: execution.width },
        );
        text(brl(order.total_cents), valueX, y + 8, {
          ...currencyOptions,
          bold: true,
        });
        y += rowHeight;
        for (const [label, cents] of details) {
          const height = Math.max(12, heightOf(label, detailWidth)) + 7;
          if (ensureRoom(height)) {
            text("OS " + order.id + " · Composição do valor", os.x, y + 8, {
              ...noteOptions,
              bold: true,
              width: width - 24,
            });
            y += 24;
          }
          text(label, service.x, y - 2, { ...noteOptions, width: detailWidth });
          if (cents != null) text(brl(cents), valueX, y - 2, {
            ...noteOptions,
            ...currencyOptions,
          });
          y += height;
        }
        line(y);
      }
      y += 24;
    }

    if (carry.length) {
      const description = {
        label: "DESCRIÇÃO",
        x: service.x,
        width: detailWidth,
      };
      const adjustmentHeight = (part) =>
        Math.max(12, heightOf(part, description.width, 10)) + 18;
      startSection("Ajustes de períodos anteriores", [
        { ...os, label: "ORDEM" },
        description,
        { ...amount, label: "VALOR DO AJUSTE" },
      ], adjustmentHeight(detailParts(carry[0].reason || "Ajuste")[0]));
      for (const adjustment of carry) {
        const parts = detailParts(adjustment.reason || "Ajuste");
        for (const [index, part] of parts.entries()) {
          const height = adjustmentHeight(part);
          const pageChanged = ensureRoom(height);
          if (!index || pageChanged) {
            text(adjustment.order_id, os.x, y + 9, { width: os.width, bold: true });
          }
          if (!index) {
            text(brl(adjustment.amount_cents), valueX, y + 9, {
              ...currencyOptions, bold: true,
            });
          }
          text(part, description.x, y + 9, { width: description.width });
          y += height;
        }
        line(y);
      }
    }

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i);
      const footer = doc.page.height - 48;
      // The footer sits below the content margin without adding a page.
      doc.page.margins.bottom = 0;
      line(footer);
      text("Zen Seguros", left, footer + 8, { ...noteOptions, width });
      text("Página " + (i + 1) + " de " + pages.count, left, footer + 8, {
        ...noteOptions,
        width,
        align: "right",
      });
    }
    doc.end();
  });
}

module.exports = { orderPdf, settlementPdf };
