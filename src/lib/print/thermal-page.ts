/**
 * Print the on-screen walk-in slip at 80mm × content height.
 *
 * Continuous roll (POS-80): page height must follow the slip. Absolute
 * positioning or a tall fixed page makes the driver center the receipt and
 * feed blank paper above and below.
 *
 * Keep this synchronous from the Print click — awaiting before print()
 * drops the user gesture and Chromium skips the dialog.
 */

import { preparePrintPaper } from "@/lib/print/paper-size";

const STYLE_ID = "umar-thermal-page-size";

/** ~2 line feeds before the cutter live in `.th-cut-feed` (2em). Do not add more. */

const SLIP_CSS = `
  * { box-sizing: border-box; }
  html, body {
    width: 80mm;
    max-width: 80mm;
    margin: 0 !important;
    padding: 0 !important;
    min-height: 0 !important;
    height: auto !important;
    background: #fff;
    color: #000;
    font-family: "Courier New", Courier, monospace;
    font-weight: 700;
    font-size: 14px;
    line-height: 1.3;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    display: block !important;
    align-items: unset !important;
    justify-content: unset !important;
  }
  .slip {
    display: block;
    position: static;
    width: 72mm;
    max-width: 72mm;
    margin: 0;
    padding: 1mm 2mm 2mm;
    background: #fff;
    color: #000;
  }
  .th-shop {
    margin: 0;
    padding: 0;
    text-align: center;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.15;
    color: #000;
  }
  .th-sub, .th-center, .th-credit { text-align: center; color: #000; }
  .th-sub { margin-top: 0.4mm; font-size: 13px; font-weight: 700; }
  .th-center { margin-top: 0.4mm; font-weight: 700; }
  .th-strong { font-weight: 700; }
  .th-meta {
    display: flex;
    justify-content: space-between;
    gap: 2mm;
    margin-top: 0.6mm;
    font-size: 12px;
    font-weight: 700;
  }
  .th-dash, .th-eq {
    width: 100%;
    overflow: hidden;
    white-space: nowrap;
    height: 1.1em;
    margin: 0.8mm 0;
    line-height: 1;
    font-size: 13px;
    font-weight: 700;
  }
  .th-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 13px;
  }
  .th-table th, .th-table td {
    padding: 0.6mm 0;
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
    align-items: baseline;
    gap: 2mm;
    margin-top: 0.6mm;
    font-weight: 700;
    color: #000;
  }
  .th-total { margin-top: 0.8mm; font-size: 16px; }
  .th-thanks {
    margin-top: 1.5mm;
    margin-bottom: 0.8mm;
    text-align: center;
    font-size: 15px;
    font-weight: 700;
  }
  .th-credit {
    margin: 0;
    padding: 0;
    font-size: 12px;
    line-height: 1.3;
    font-weight: 700;
  }
  .th-credit-line {
    display: block;
    white-space: nowrap;
  }
  /* Exactly 2 line feeds before cutter — not 4+. */
  .th-cut-feed {
    display: block;
    height: 2em;
    margin: 0;
    padding: 0;
    line-height: 1;
    overflow: hidden;
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

/** Content height in mm. Cutter clearance is already in `.th-cut-feed`. */
function pxToPageMm(px: number) {
  return Math.max(20, Math.ceil((px * 25.4) / 96));
}

function slipHeightMm(slip: HTMLElement) {
  const px = Math.max(
    slip.scrollHeight,
    slip.offsetHeight,
    Math.ceil(slip.getBoundingClientRect().height),
    1,
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
  // Prefer auto; inject measured height as a fallback for Chromium/Electron
  // drivers that ignore `auto` and otherwise default to a tall roll.
  style.textContent = `
@media print {
  @page {
    size: 80mm auto;
    margin: 0;
  }
  @page thermal-80 {
    size: 80mm ${pageMm}mm;
    margin: 0;
  }
}
`;
  document.head.appendChild(style);
}

function receiptHtml(inner: string) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title></title>
<style>
  @page { size: 80mm auto; margin: 0; }
  ${SLIP_CSS}
</style>
</head>
<body><div class="slip">${inner}<div class="th-cut-feed" aria-hidden="true"></div></div></body>
</html>`;
}

function printViaIframe(slip: HTMLElement) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // Real width so the slip lays out at 72mm before print.
  frame.style.cssText =
    "position:fixed;left:0;top:0;width:302px;height:1px;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  if (!doc || !view) {
    frame.remove();
    return false;
  }

  const inner = slip.innerHTML;
  doc.open();
  doc.write(receiptHtml(inner));
  doc.close();
  void doc.body?.offsetHeight;

  const painted = doc.querySelector<HTMLElement>(".slip");
  const pageMm = painted ? pxToPageMm(painted.scrollHeight || painted.offsetHeight || 1) : 80;

  // Re-apply with measured named page for drivers that ignore `auto`.
  const style = doc.createElement("style");
  style.textContent = `
    @page { size: 80mm ${pageMm}mm; margin: 0; }
    @page thermal-80 { size: 80mm ${pageMm}mm; margin: 0; }
  `;
  doc.head.appendChild(style);
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
  preparePrintPaper("thermal");
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
