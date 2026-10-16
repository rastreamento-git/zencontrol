async function readPdf(bytes) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
  });
  const doc = await loading.promise,
    pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i),
        content = await page.getTextContent();
      pages.push({
        width: page.view[2],
        height: page.view[3],
        items: content.items,
        text: content.items.map((t) => t.str).join(" "),
      });
    }
    return {
      count: doc.numPages,
      pages,
      text: pages.map((p) => p.text).join("\n"),
    };
  } finally {
    await loading.destroy();
  }
}
module.exports = { readPdf };
