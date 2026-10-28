"use client";

import { useDialogDocumentNo } from "@/components/ui/create-dialog";
import { allocateSequentialDocNo } from "@/lib/offline/offline-submit";
import { createClient } from "@/lib/supabase/client";
import { useEffect } from "react";

const DEFAULTS = {
  sale_invoice: { prefix: "SI-", pad: 4 },
  purchase_invoice: { prefix: "PI-", pad: 4 },
} as const;

function formatNo(prefix: string, next: number, pad: number) {
  const body = pad > 0 ? String(next).padStart(pad, "0") : String(next);
  return `${prefix}${body}`;
}

/** Next invoice number the save will generate. Does not use up the number. */
export async function previewDocumentNo(
  companyId: string,
  series: "sale_invoice" | "purchase_invoice",
): Promise<string> {
  const fallback = DEFAULTS[series];
  try {
    const { isAppOnline } = await import("@/lib/offline/local-auth");
    if (await isAppOnline()) {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("peek_document_series", {
        p_company_id: companyId,
        p_series_type: series,
      });
      if (!error && data) {
        const seriesRow = data as {
          prefix?: string;
          next_number?: number;
          padding?: number;
        };
        const next = Number(seriesRow.next_number || 0);
        if (next > 0) {
          return formatNo(
            seriesRow.prefix || fallback.prefix,
            next,
            Number(seriesRow.padding ?? fallback.pad),
          );
        }
      }
      if (!error && !data) return formatNo(fallback.prefix, 1, fallback.pad);
    }
  } catch {
    // Fall through to the local series, which is what an offline save uses.
  }
  return allocateSequentialDocNo(series, companyId, { reserve: false });
}

/** Puts the next (or existing) invoice number in the dialog header. */
export function useDialogInvoiceNo(
  companyId: string,
  series: "sale_invoice" | "purchase_invoice",
  existingNo?: string | null,
) {
  const setDocumentNo = useDialogDocumentNo();

  useEffect(() => {
    if (!setDocumentNo) return;
    if (existingNo) {
      setDocumentNo(existingNo);
      return () => setDocumentNo(null);
    }
    let cancelled = false;
    void previewDocumentNo(companyId, series).then((no) => {
      if (!cancelled && no) setDocumentNo(no);
    });
    return () => {
      cancelled = true;
      setDocumentNo(null);
    };
  }, [companyId, series, existingNo, setDocumentNo]);
}
