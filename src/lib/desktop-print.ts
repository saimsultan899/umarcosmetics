/**
 * In Electron, replace window.print() with a PDF preview flow so Windows
 * does not show “This app doesn’t support print preview”.
 * Walk-in thermal slips do not use this path. They print from their own 80mm page.
 *
 * Before printing, paper size is fixed from the invoice layout (A4 / A5 / thermal).
 */

import {
  buildPrintFrameHtml,
  clearPrintPaper,
  preparePrintPaper,
} from "@/lib/print/paper-size";

type DesktopPrintPayload = {
  html: string;
  paper: "thermal" | "a5" | "a4" | "a4-landscape";
};

type DesktopPrintBridge = {
  isDesktop?: boolean;
  printPreview?: (
    payload?: DesktopPrintPayload,
  ) => Promise<{ ok?: boolean; error?: string | null }>;
  print?: (
    payload?: DesktopPrintPayload,
  ) => Promise<{ ok?: boolean; error?: string | null }>;
};

let installed = false;

export function installDesktopPrint() {
  if (typeof window === "undefined" || installed) return;
  const desktop = (window as Window & { umarDesktop?: DesktopPrintBridge })
    .umarDesktop;
  if (!desktop?.isDesktop) return;

  installed = true;
  const nativePrint = window.print.bind(window);

  window.print = () => {
    const paper = preparePrintPaper();
    const cleanup = () => {
      clearPrintPaper();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.setTimeout(cleanup, 60_000);

    const run = async () => {
      try {
        // Thermal still measures the live slip. A4 and A5 print the same
        // standalone page the browser uses, online and offline.
        if (paper !== "thermal") {
          const html = buildPrintFrameHtml(paper);
          if (html && desktop.printPreview) {
            const res = await desktop.printPreview({ html, paper });
            if (res?.ok) return;
          }
          if (html && desktop.print) {
            await desktop.print({ html, paper });
            return;
          }
        }
        if (desktop.printPreview) {
          const res = await desktop.printPreview();
          if (res?.ok) return;
        }
        if (desktop.print) {
          await desktop.print();
          return;
        }
      } catch (err) {
        console.warn("[desktop-print] fallback to window.print", err);
      }
      nativePrint();
    };
    void run();
  };
}
