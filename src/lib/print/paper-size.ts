/**
 * Map the on-screen invoice layout to the printer paper size so Print does
 * not leave A4/A5/Thermal up to the user (wrong size breaks the layout).
 *
 * - thermal-80 / thermal-print-mode → 80mm roll
 * - si-half / cdoc--half / doc--half → A5 portrait, content upright
 * - si-a4 → A4 portrait (full sale invoice)
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
    if (el.classList.contains("si-a4")) return "a4";
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
  const active = pageRule(paper);
  return `
@page { ${active} }
@page paper-thermal { size: 80mm auto; margin: 0; }
@page paper-a5 { size: A5 portrait; margin: 8mm; }
@page paper-a4 { size: A4 portrait; margin: 8mm 10mm; }
@page thermal-80 { size: 80mm auto; margin: 0; }
@page si-half-page { ${paper === "a5" ? active : "size: A5 portrait; margin: 8mm;"} }
@page invoice-page { ${paper === "a4" ? active : paper === "a5" ? active : "size: A4 portrait; margin: 8mm 10mm;"} }
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
  style.textContent = `@media print {\n${paperCss(next)}\nhtml[data-print-paper="${next}"] { page: paper-${next}; }\n}`;
  return next;
}

export function clearPrintPaper() {
  if (typeof document === "undefined") return;
  document.documentElement.removeAttribute(ATTR);
  document.getElementById(STYLE_ID)?.remove();
}

function isDesktopApp() {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as Window & { umarDesktop?: { isDesktop?: boolean } }).umarDesktop
      ?.isDesktop,
  );
}

/** Drop every @page rule so the iframe has exactly one paper size. */
function stripPageAtRules(css: string) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@page", i);
    if (at === -1) {
      out += css.slice(i);
      break;
    }
    const prev = at > 0 ? css[at - 1] : " ";
    if (!/[\s{;]/.test(prev)) {
      out += css.slice(i, at + 5);
      i = at + 5;
      continue;
    }
    const brace = css.indexOf("{", at);
    if (brace === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    let depth = 0;
    let j = brace;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    i = j;
  }
  return out;
}

function collectedCss() {
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      css += `${stripPageAtRules(rule.cssText)}\n`;
    }
  }
  return css;
}

function pageRule(paper: PrintPaperSize) {
  if (paper === "thermal") return "size: 80mm auto; margin: 0;";
  if (paper === "a5") return "size: A5 portrait; margin: 8mm;";
  return "size: A4 portrait; margin: 8mm 10mm;";
}

function frameBox(paper: PrintPaperSize) {
  if (paper === "thermal") return { w: 320, h: 1600 };
  if (paper === "a5") return { w: 560, h: 794 };
  return { w: 794, h: 1123 };
}

function uprightHalfSheetCss(paper: PrintPaperSize) {
  if (paper !== "a5") return "";
  return `
@media print {
  .print-sheet.si-half,
  .print-sheet.cdoc--half {
    transform: none !important;
    left: 0 !important;
    right: 0 !important;
    top: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    height: auto !important;
  }
}`;
}

/** Long reports must stay in normal flow or Chrome inserts a blank first page. */
function reportFlowCss() {
  return `
@media print {
  .print-sheet.report-print,
  .print-sheet.recovery-sheet,
  .print-sheet.table-shell,
  .print-sheet.si-a4 {
    position: static !important;
    left: auto !important;
    right: auto !important;
    top: auto !important;
    width: 100% !important;
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
  }
}`;
}

/** Same document the browser print frame uses, so the desktop exe matches it. */
export function buildPrintFrameHtml(paper: PrintPaperSize): string | null {
  const sheets = visiblePrintSheets();
  if (!sheets.length) return null;
  const bodyHtml = sheets
    .map((sheet, i) => {
      const html = sheet.outerHTML;
      if (sheets.length === 1 || i === sheets.length - 1) return html;
      return `${html}<div style="page-break-after:always;break-after:page"></div>`;
    })
    .join("");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<base href="${location.origin}/" />
<title></title>
<style>
${collectedCss()}
@page { ${pageRule(paper)} }
html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  background-color: #fff !important;
}
@media print {
  .print-sheet, .print-sheet * { visibility: visible !important; }
  .print-sheet { page: auto !important; background: #fff !important; }
}
${uprightHalfSheetCss(paper)}
${reportFlowCss()}
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

function visiblePrintSheets() {
  const batch = document.querySelector(".batch-sale-prints");
  const root = batch || document;
  const sheets = Array.from(
    root.querySelectorAll<HTMLElement>(".print-sheet"),
  ).filter((el) => !el.classList.contains("print-skip"));
  const visible = sheets.filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
  return visible.length ? visible : sheets;
}

function activePrintSheet() {
  return visiblePrintSheets()[0] || null;
}

/**
 * Browser print dialogs keep the last paper (usually A4) when the app page
 * also contains `@page { size: A4 }`. A clean document with one @page rule is
 * what Chrome and the desktop exe both print, online and offline.
 * Walk-in thermal slips stay on their own 80mm path.
 */
export function printWithAutoPaper(paper?: PrintPaperSize) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const next = preparePrintPaper(paper);

  const html = buildPrintFrameHtml(next);
  if (!html) {
    window.print();
    return;
  }

  if (isDesktopApp()) {
    window.print();
    return;
  }

  const box = frameBox(next);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-12000px;top:0;width:${box.w}px;height:${box.h}px;border:0;opacity:1;`;
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  if (!doc || !view) {
    frame.remove();
    window.print();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();
  void doc.body?.offsetHeight;

  const cleanup = () => {
    try {
      frame.remove();
    } catch {
      /* ignore */
    }
    clearPrintPaper();
  };
  view.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(cleanup, 60_000);
  view.focus();
  view.print();
}
