const SLIP_CSS = `
  * { box-sizing: border-box; }
  html, body {
    width: 80mm;
    max-width: 80mm;
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
    font-family: "Courier New", Courier, monospace;
    font-weight: 700;
    font-size: 14px;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .slip {
    position: absolute;
    top: 0;
    left: 0;
    width: 80mm;
    max-width: 80mm;
    margin: 0;
    padding: 3mm 3mm 3mm;
    box-sizing: border-box;
    overflow: visible;
    background: #fff;
    color: #000;
  }
  .th-shop {
    text-align: center;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.15;
  }
  .th-sub, .th-center, .th-credit { text-align: center; }
  .th-sub { margin-top: 1mm; font-size: 13px; }
  .th-center { margin-top: 0.8mm; }
  .th-strong { font-weight: 700; }
  .th-meta {
    display: flex;
    justify-content: space-between;
    gap: 2mm;
    margin-top: 1mm;
    font-size: 12px;
  }
  .th-dash, .th-eq {
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    height: 1.15em;
    margin: 1.6mm 0;
    line-height: 1;
    font-size: 13px;
    color: #000;
  }
  .th-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 13px;
  }
  .th-table th, .th-table td {
    padding: 1mm 0;
    border: none;
    vertical-align: top;
    font-weight: 700;
    color: #000;
  }
  .th-table th:first-child, .th-table td:first-child { width: 46%; text-align: left; }
  .th-table .num { width: 18%; text-align: right; white-space: nowrap; }
  .th-row {
    display: flex;
    justify-content: space-between;
    gap: 2mm;
    margin-top: 1mm;
  }
  .th-total { margin-top: 1.4mm; font-size: 16px; }
  .th-thanks {
    margin-top: 3mm;
    margin-bottom: 3mm;
    text-align: center;
    font-size: 15px;
  }
  .th-credit { margin: 0; font-size: 12px; line-height: 1.45; }
`;

function receiptHtml(inner: string, pageMm: number | null) {
  const pageCss = pageMm
    ? `@page { size: 80mm ${pageMm}mm; margin: 0; }
       html, body { height: ${pageMm}mm; max-height: ${pageMm}mm; overflow: hidden; }`
    : `@page { size: 80mm auto; margin: 0; }
       html, body { height: auto; overflow: visible; }`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt</title>
<style>
  ${pageCss}
  ${SLIP_CSS}
</style>
</head>
<body><div class="slip">${inner}</div></body>
</html>`;
}

/**
 * Print the walk-in slip on its own 80mm page.
 * The app page is A4, so printing it directly shrinks the slip and leaves a long blank sheet.
 */
function pageMmFromSlip(doc: Document) {
  const slip = doc.querySelector<HTMLElement>(".slip");
  const px = Math.max(slip?.scrollHeight || 0, slip?.offsetHeight || 0, 120);
  // Half a millimetre keeps the last line off the cutter without a blank band.
  return Math.max(40, Math.ceil((px * 25.4) / 96 + 0.5));
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function printThermalSlip(source: HTMLElement) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;left:-1200px;top:0;width:302px;height:900px;border:0;pointer-events:none;";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  if (!doc || !view) {
    frame.remove();
    window.print();
    return;
  }

  const paint = (pageMm: number | null) => {
    doc.open();
    doc.write(receiptHtml(source.innerHTML, pageMm));
    doc.close();
  };

  const run = async () => {
    paint(null);
    if (doc.fonts?.ready) await doc.fonts.ready.catch(() => undefined);
    await nextFrame();
    let pageMm = pageMmFromSlip(doc);
    paint(pageMm);
    if (doc.fonts?.ready) await doc.fonts.ready.catch(() => undefined);
    await nextFrame();
    const fitted = pageMmFromSlip(doc);
    if (fitted !== pageMm) {
      pageMm = fitted;
      paint(pageMm);
      await nextFrame();
    }
    view.addEventListener("afterprint", () => frame.remove(), { once: true });
    view.focus();
    view.print();
    window.setTimeout(() => frame.remove(), 20000);
  };

  void run();
}
