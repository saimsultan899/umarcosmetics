"use client";

import { PrintButton } from "@/components/ui/print-button";
import { Button } from "@/components/ui/button";
import { downloadExcel, downloadPdf } from "@/lib/reports/export";
import { FileSpreadsheet, FileText } from "lucide-react";

export function ExportButtons({
  rows,
  filename,
  title,
}: {
  rows: Record<string, unknown>[];
  filename: string;
  title?: string;
}) {
  return (
    <div className="no-print flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!rows.length}
        onClick={() => downloadExcel(rows, filename)}
      >
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!rows.length}
        onClick={() => void downloadPdf(rows, filename, title)}
      >
        <FileText className="h-4 w-4" />
        PDF
      </Button>
      <PrintButton label="Print" />
    </div>
  );
}
