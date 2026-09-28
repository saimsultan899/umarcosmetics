/**
 * Print the on-screen walk-in slip at a tight 80mm × content page.
 *
 * Browser: isolated iframe document (avoids A4 + app chrome).
 * Desktop: Electron print hook with the same tight page size.
 *
 * Keep this synchronous from the Print click — awaiting before print()
 * drops the user gesture and Chromium skips the dialog.
 *
 * Do not set html/body to a fixed tall height. That made Chromium center
 * the short slip on the page and left a large blank at the top.
 */

const STYLE_ID = "umar-thermal-page-size";

/** Side inset + small cutter gap under the last phone line. */
const SLIP_PAD = "0 2mm 3mm";

const SLIP_CSS = `
  * { box-sizing: border-box; }
  html, body {
    width: 80mm;
    max-width: 80mm;
    margin: 0;
    padding: 0;
    min-height: 0;
    height: auto;
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
    padding: ${SLIP_PAD};
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
  .th-sub { margin-top: 0.6mm; font-size: 13px; }
  .th-center { margin-top: 0.5mm; }
  .th-strong { font-weight: 700; }
  .th-meta {
    display: flex;
    justify-content: space-between;
    gap: 2mm;
    margin-top: 0.8mm;
    font-size: 12px;
  }
  .th-dash, .th-eq {
    width: 100%;
    overflow: hidden;
    white-space: nowrap;
    height: 1.15em;
    margin: 1.2mm 0;
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
    padding: 0.8mm 0;
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
    margin-top: 0.8mm;
  }
  .th-total { margin-top: 1mm; font-size: 16px; }
  .th-thanks {
    margin-top: 2mm;
    margin-bottom: 1.2mm;
    text-align: center;
    font-size: 15px;
  }
  .th-credit {
    margin: 0;
    padding: 0;
    font-size: 12px;
    line-height: 1.35;
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

function pxToPageMm(px: number) {
  // Tight fit: ~3mm under the last line for the cutter only.
  return Math.max(40, Math.ceil((px * 25.4) / 96) + 3);
}

function slipHeightMm(slip: HTMLElement) {
  const px = Math.max(
    slip.scrollHeight,
    slip.offsetHeight,
    Math.ceil(slip.getBoundingClientRect().height),
    100,
  );
  return pxToPageMm(px);
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
</style>
</head>
<body><div class="slip">${inner}</div></body>
</html>`;
}

function printViaIframe(slip: HTMLElement) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // Give the iframe a real width so the slip lays out at 80mm before we measure.
  frame.style.cssText =
    "position:fixed;left:0;top:0;width:302px;height:800px;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  if (!doc || !view) {
    frame.remove();
    return false;
  }

  const inner = slip.innerHTML;
  // First paint with a tall guess, then shrink @page to the real slip height
  // so the driver does not center a short receipt on a tall page.
  doc.open();
  doc.write(receiptHtml(inner, 400));
  doc.close();
  void doc.body?.offsetHeight;

  const painted = doc.querySelector<HTMLElement>(".slip");
  const px = Math.max(
    painted?.scrollHeight || 0,
    painted?.offsetHeight || 0,
    100,
  );
  const pageMm = pxToPageMm(px);

  doc.open();
  doc.write(receiptHtml(inner, pageMm));
  doc.close();
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

  // Electron uses the desktop print bridge on window.print().
  if (isDesktopApp()) {
    printViaDesktopShell(slip, slipHeightMm(slip));
    return;
  }

  if (!printViaIframe(slip)) {
    printViaDesktopShell(slip, slipHeightMm(slip));
  }
}
