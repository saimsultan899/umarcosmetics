"use client";

import { PrintButton } from "@/components/ui/print-button";
import { Button } from "@/components/ui/button";
import { downloadCsv, downloadExcel } from "@/lib/reports/export";
import { FileDown, FileSpreadsheet } from "lucide-react";

export function ExportButtons({
  rows,
  filename,
}: {
  rows: Record<string, unknown>[];
  filename: string;
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
        onClick={() => downloadCsv(rows, filename)}
      >
        <FileDown className="h-4 w-4" />
        CSV
      </Button>
      <PrintButton label="Print" />
    </div>
  );
}
