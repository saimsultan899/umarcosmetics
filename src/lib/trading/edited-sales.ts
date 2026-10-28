export type EditedSaleRef = {
  id: string;
  invoiceNo: string;
  date: string;
  code: string;
  name: string;
  total: number;
  href: string;
};

type RawSale = {
  id?: unknown;
  invoice_no?: unknown;
  invoice_date?: unknown;
  return_no?: unknown;
  return_date?: unknown;
  grand_total?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  status?: unknown;
  parties?: { party_code?: string; name_en?: string } | { party_code?: string; name_en?: string }[] | null;
};

function partyOf(row: RawSale) {
  const party = Array.isArray(row.parties) ? row.parties[0] : row.parties;
  return {
    code: String(party?.party_code || "").trim(),
    name: String(party?.name_en || "").trim(),
  };
}

/** True when the bill was saved again after it was first created. */
export function wasEdited(createdAt: unknown, updatedAt: unknown) {
  const created = Date.parse(String(createdAt || ""));
  const updated = Date.parse(String(updatedAt || ""));
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;
  return updated - created > 2000;
}

/** Bills changed after they were first saved, newest edit first. */
export function pickEditedDocuments(
  rows: RawSale[],
  opts: {
    hrefPrefix: string;
    noField?: "invoice_no" | "return_no";
    dateField?: "invoice_date" | "return_date";
    limit?: number;
  },
): EditedSaleRef[] {
  const noField = opts.noField || "invoice_no";
  const dateField = opts.dateField || "invoice_date";
  const limit = opts.limit ?? 8;
  const edited = rows.filter((row) => {
    const status = String(row.status || "posted");
    if (status === "cancelled" || status === "voided") return false;
    return wasEdited(row.created_at, row.updated_at);
  });
  edited.sort(
    (a, b) =>
      Date.parse(String(b.updated_at || "")) - Date.parse(String(a.updated_at || "")),
  );
  return edited.slice(0, limit).map((row) => {
    const party = partyOf(row);
    const id = String(row.id || "");
    return {
      id,
      invoiceNo: String(row[noField] || ""),
      date: String(row[dateField] || "").slice(0, 10),
      code: party.code,
      name: party.name,
      total: Number(row.grand_total) || 0,
      href: `${opts.hrefPrefix}/${id}`,
    };
  });
}

export function pickEditedSales(rows: RawSale[], limit = 8): EditedSaleRef[] {
  return pickEditedDocuments(rows, { hrefPrefix: "/sales/invoices", limit });
}
