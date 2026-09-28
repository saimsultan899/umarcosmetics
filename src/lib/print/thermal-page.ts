/**
 * Print the on-screen walk-in slip at a true 80mm page size.
 *
 * Must stay synchronous from the Print click (or Ctrl+P). Awaiting fonts /
 * frames before print() drops the user gesture, so Chromium silently skips
 * the dialog.
 *
 * The app’s default @page is A4. For thermal we inject an exact
 * `80mm × content-height` page so the POS roll does not feed blank paper.
 * The style tag is removed after print so standard invoices stay A4.
 */

const STYLE_ID = "umar-thermal-page-size";

function slipHeightMm(slip: HTMLElement) {
  const px = Math.max(
    slip.scrollHeight,
    slip.offsetHeight,
    Math.ceil(slip.getBoundingClientRect().height),
    120,
  );
  // ~96 CSS px per inch; +3mm keeps the cutter clear of the last line.
  return Math.max(45, Math.ceil((px * 25.4) / 96) + 3);
}

function removeThermalPageStyle() {
  document.getElementById(STYLE_ID)?.remove();
}

function installThermalPageStyle(pageMm: number) {
  removeThermalPageStyle();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Override the default A4 @page for this job only. Named page matches
  // `.print-sheet.thermal-80 { page: thermal-80 }`.
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
  return style;
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
  // Electron print IPC may not always fire afterprint.
  window.setTimeout(cleanup, 60_000);

  window.print();
}
