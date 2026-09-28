/**
 * Map the on-screen invoice layout to the printer paper size so Print does
 * not leave A4/A5/Thermal up to the user (wrong size breaks the layout).
 *
 * - thermal-80 / thermal-print-mode → 80mm roll
 * - si-half / cdoc--half / doc--half → A5 landscape (same footprint as half A4)
 * - everything else → A4 portrait
 */

export type PrintPaperSize = "thermal" | "a5" | "a4";

const STYLE_ID = "umar-print-paper-size";
const ATTR = "data-print-paper";

export function detectPrintPaper(root: ParentNode = document): PrintPaperSize {
  if (typeof document !== "undefined") {
    const forced = document.documentElement.getAttribute(ATTR);
    if (forced === "thermal" || forced === "a5" || forced === "a4") {
      return forced;
    }
    if (document.documentElement.classList.contains("thermal-print-mode")) {
      return "thermal";
    }
  }

  const sheets = Array.from(root.querySelectorAll<HTMLElement>(".print-sheet")).filter(
    (el) => !el.classList.contains("print-skip"),
  );

  for (const el of sheets) {
    const paper = el.getAttribute("data-paper");
    if (paper === "thermal" || paper === "a5" || paper === "a4") return paper;
    if (el.classList.contains("thermal-80")) return "thermal";
    if (
      el.classList.contains("si-half") ||
      el.classList.contains("cdoc--half") ||
      el.classList.contains("doc--half")
    ) {
      return "a5";
    }
  }

  return "a4";
}

function paperCss(paper: PrintPaperSize) {
  if (paper === "thermal") {
    return `
@page { size: 80mm auto; margin: 0; }
@page thermal-80 { size: 80mm auto; margin: 0; }
`;
  }
  if (paper === "a5") {
    // Half-A4 slip footprint = A5 landscape (210mm × 148mm).
    return `
@page { size: A5 landscape; margin: 4mm 2mm; }
@page si-half-page { size: A5 landscape; margin: 4mm 2mm; }
@page invoice-page { size: A5 landscape; margin: 4mm 2mm; }
`;
  }
  return `
@page { size: A4 portrait; margin: 10mm 12mm; }
@page invoice-page { size: A4 portrait; margin: 5mm 2mm; }
@page si-half-page { size: A4 portrait; margin: 4mm 2mm; }
`;
}

/** Mark the document and inject @page so Chromium / Electron pick the right size. */
export function preparePrintPaper(paper?: PrintPaperSize): PrintPaperSize {
  if (typeof document === "undefined") return paper || "a4";
  const next = paper || detectPrintPaper();
  document.documentElement.setAttribute(ATTR, next);

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `@media print {\n${paperCss(next)}\n}`;
  return next;
}

export function clearPrintPaper() {
  if (typeof document === "undefined") return;
  document.documentElement.removeAttribute(ATTR);
  document.getElementById(STYLE_ID)?.remove();
}
