"use client";

import * as XLSX from "xlsx";

export function downloadExcel(
  rows: Record<string, unknown>[],
  filename: string,
  sheetName = "Report",
) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

function visibleExportKeys(rows: Record<string, unknown>[]) {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).filter((k) => !k.startsWith("_"));
}

function cellText(value: unknown) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  }
  return String(value);
}

export async function downloadPdf(
  rows: Record<string, unknown>[],
  filename: string,
  title?: string,
) {
  if (!rows.length) return;
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableMod.default;
  const headers = visibleExportKeys(rows);
  const landscape = headers.length > 6;
  const doc = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });
  const heading = (title || filename).trim() || "Report";
  doc.setFontSize(13);
  doc.text(heading, 14, 14);
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(`Printed ${new Date().toLocaleString()} · ${rows.length} rows`, 14, 20);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 24,
    head: [headers],
    body: rows.map((row) => headers.map((h) => cellText(row[h]))),
    styles: { fontSize: 7, cellPadding: 1.4 },
    headStyles: { fillColor: [211, 84, 67], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 246, 244] },
    margin: { left: 10, right: 10 },
  });

  const name = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  doc.save(name);
}
