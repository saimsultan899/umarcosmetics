/**
 * Print the on-screen walk-in slip at a true 80mm × content page.
 *
 * Browser: print from a tiny off-screen document (no A4 shell, no top gap).
 * Desktop: keep the Electron print hook, but pin the slip to the top and
 * size the page to the receipt so the footer phones are not cut off.
 *
 * Must stay synchronous from the Print click — awaiting before print() drops
 * the user gesture and Chromium skips the dialog.
 */

const STYLE_ID = "umar-thermal-page-size";

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
    width: 80mm;
    max-width: 80mm;
    margin: 0;
    padding: 0 2.5mm 8mm;
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
    overflow: hidden;
    white-space: nowrap;
    height: 1.15em;
    margin: 1.6mm 0;
    line-height: 1;
    font-size: 13px;
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
    margin-bottom: 2mm;
    text-align: center;
    font-size: 15px;
  }
  .th-credit {
    margin: 0;
    padding: 0;
    font-size: 12px;
    line-height: 1.4;
  }
  .th-credit-line {
    display: block;
    white-space: nowrap;
  }
`;

type DesktopPrintBridge = {
  isDesktop?: boolean;
};

function isDesktopApp() {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as Window & { umarDesktop?: DesktopPrintBridge }).umarDesktop
      ?.isDesktop,
  );
}

function slipHeightMm(slip: HTMLElement) {
  const px = Math.max(
    slip.scrollHeight,
    slip.offsetHeight,
    Math.ceil(slip.getBoundingClientRect().height),
    120,
  );
  // Extra bottom mm keeps developer phone lines above the cutter.
  return Math.max(50, Math.ceil((px * 25.4) / 96) + 10);
}

function removeThermalPageStyle() {
  document.getElementById(STYLE_ID)?.remove();
}

function installThermalPageStyle(pageMm: number) {
  removeThermalPageStyle();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
@media print {
  @page {
    size: 80mm ${pageMm}mm !important;
    margin: 0 !important;
  }
  @page thermal-80 {
    size: 80mm ${pageMm}mm !important;
    margin: 0 !important;
  }
}
`;
  document.head.appendChild(style);
}

function receiptHtml(inner: string, pageMm: number) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt</title>
<style>
  @page { size: 80mm ${pageMm}mm; margin: 0; }
  ${SLIP_CSS}
  html, body { height: ${pageMm}mm; max-height: ${pageMm}mm; overflow: hidden; }
</style>
</head>
<body><div class="slip">${inner}</div></body>
</html>`;
}

function printViaIframe(slip: HTMLElement, pageMm: number) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;left:0;top:0;width:302px;height:1px;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  if (!doc || !view) {
    frame.remove();
    return false;
  }

  doc.open();
  doc.write(receiptHtml(slip.innerHTML, pageMm));
  doc.close();
  // Force layout so the first paint is ready before print().
  void doc.body?.offsetHeight;

  const cleanup = () => {
    try {
      frame.remove();
    } catch {
      /* ignore */
    }
  };
  view.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(cleanup, 20_000);
  view.focus();
  view.print();
  return true;
}

function printViaDesktopShell(slip: HTMLElement, pageMm: number) {
  installThermalPageStyle(pageMm);
  const root = document.documentElement;
  root.classList.add("thermal-print-mode");
  root.setAttribute("data-thermal-page-mm", String(pageMm));

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    root.classList.remove("thermal-print-mode");
    root.removeAttribute("data-thermal-page-mm");
    removeThermalPageStyle();
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);
  window.setTimeout(cleanup, 60_000);
  window.print();
  void slip;
}

export function printThermalSlip(source?: HTMLElement | null) {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const slip =
    source ??
    document.querySelector<HTMLElement>(".print-sheet.thermal-80");
  if (!slip) {
    window.print();
    return;
  }

  const pageMm = slipHeightMm(slip);

  // Electron uses the desktop print bridge on window.print().
  if (isDesktopApp()) {
    printViaDesktopShell(slip, pageMm);
    return;
  }

  if (!printViaIframe(slip, pageMm)) {
    printViaDesktopShell(slip, pageMm);
  }
}
