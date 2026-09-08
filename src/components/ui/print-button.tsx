"use client";

import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

/**
 * Print the page. When `printId` is set, only the matching
 * `.print-sheet[data-print-id="..."]` is included (other sheets are skipped).
 */
export function PrintButton({
  label = "Print",
  printId,
}: {
  label?: string;
  /** Match a print sheet's data-print-id so other reports stay out of the printout. */
  printId?: string;
}) {
  function onPrint() {
    const sheets = Array.from(
      document.querySelectorAll<HTMLElement>(".print-sheet"),
    );
    const skipped: HTMLElement[] = [];

    if (printId) {
      for (const sheet of sheets) {
        if (sheet.getAttribute("data-print-id") !== printId) {
          sheet.classList.add("print-skip");
          skipped.push(sheet);
        }
      }
    }

    function cleanup() {
      for (const sheet of skipped) {
        sheet.classList.remove("print-skip");
      }
      window.removeEventListener("afterprint", cleanup);
    }

    window.addEventListener("afterprint", cleanup);
    window.print();
    // Fallback if afterprint never fires (some browsers).
    window.setTimeout(cleanup, 2000);
  }

  return (
    <Button
      type="button"
      variant="secondary"
      className="no-print"
      onClick={onPrint}
    >
      <Printer className="h-4 w-4" />
      {label}
    </Button>
  );
}
