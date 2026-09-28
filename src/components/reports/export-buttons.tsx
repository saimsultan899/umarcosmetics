"use client";

import { PrintButton } from "@/components/ui/print-button";
import { Button } from "@/components/ui/button";
import { downloadExcel, downloadPdf } from "@/lib/reports/export";
import { FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";

export function ExportButtons({
  rows,
  filename,
  title,
  printId,
}: {
  rows: Record<string, unknown>[];
  filename: string;
  title?: string;
  /** When set, Print only outputs this report's print sheet. */
  printId?: string;
}) {
  const [excelBusy, setExcelBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  return (
    <div className="no-print flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={excelBusy}
        disabled={!rows.length}
        onClick={() => {
          setExcelBusy(true);
          try {
            downloadExcel(rows, filename);
          } finally {
            window.setTimeout(() => setExcelBusy(false), 400);
          }
        }}
      >
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={pdfBusy}
        disabled={!rows.length}
        onClick={() => {
          setPdfBusy(true);
          void Promise.resolve(downloadPdf(rows, filename, title)).finally(() =>
            setPdfBusy(false),
          );
        }}
      >
        <FileText className="h-4 w-4" />
        PDF
      </Button>
      <PrintButton label="Print" printId={printId} />
    </div>
  );
}
