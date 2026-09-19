"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { getCachedRows } from "@/lib/offline/local-db";
import { offlineAccountsBalances } from "@/lib/offline/offline-reports";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import { useEffect, useMemo, useState } from "react";

export type PartyInsightProduct = {
  code: string;
  name: string;
  qty: number;
  amount: number;
  lastRate: number;
};

export type PartyInsightSale = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  grand_total: number;
  amount_paid: number;
  payment_type: string;
};

export type PartyInsightRecovery = {
  id: string;
  recovery_date: string;
  amount: number;
  receipt_no: string | null;
  narration: string | null;
};

export type PartyInsightsState = {
  party: Party | null;
  balance: number;
  sales: PartyInsightSale[];
  recoveries: PartyInsightRecovery[];
  products: PartyInsightProduct[];
  loading: boolean;
};

export function usePartyInsights({
  companyId,
  partyId,
  initialParty,
  initialBalance = 0,
  initialSales = [],
  initialRecoveries = [],
  initialProducts = [],
  initialOffline = false,
}: {
  companyId: string;
  partyId: string;
  initialParty?: Party | null;
  initialBalance?: number;
  initialSales?: PartyInsightSale[];
  initialRecoveries?: PartyInsightRecovery[];
  initialProducts?: PartyInsightProduct[];
  initialOffline?: boolean;
}): PartyInsightsState {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;

  const [party, setParty] = useState<Party | null>(initialParty || null);
  const [balance, setBalance] = useState<number>(initialBalance);
  const [sales, setSales] = useState<PartyInsightSale[]>(initialSales);
  const [recoveries, setRecoveries] = useState<PartyInsightRecovery[]>(initialRecoveries);
  const [products, setProducts] = useState<PartyInsightProduct[]>(initialProducts);
  const [loading, setLoading] = useState(!initialParty);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isOnline) {
        // Offline: read from local SQLite / IndexedDB
        try {
          const {
            hasLocalSqlite,
            localListMaster,
            localListDocuments,
            localListDocumentsByTypes,
          } = await import("@/lib/offline/sqlite-client");

          let partyRows: Record<string, unknown>[] = [];
          let saleRows: Record<string, unknown>[] = [];
          let voucherRows: Record<string, unknown>[] = [];

          if (hasLocalSqlite()) {
            const [pRes, sRes, vRes] = await Promise.all([
              localListMaster("parties", companyId),
              localListDocuments("sale_invoices", companyId, 2000),
              localListDocumentsByTypes(companyId, [
                "recovery",
                "cash_receipt",
                "receipt",
                "voucher",
              ]),
            ]);
            partyRows = pRes.rows || [];
            saleRows = sRes.rows || [];
            voucherRows = vRes.rows || [];
          }

          if (!partyRows.length) partyRows = await getCachedRows("parties", companyId);
          if (!saleRows.length) saleRows = await getCachedRows("sale_invoices", companyId);
          if (!voucherRows.length) voucherRows = await getCachedRows("vouchers", companyId);

          const balList = await offlineAccountsBalances(companyId);

          if (cancelled) return;

          const foundParty = partyRows.find((p) => String(p.id) === partyId) as unknown as Party | undefined;
          if (foundParty) setParty(foundParty);

          const partyBalObj = balList.find((b) => b.party_id === partyId);
          const currentBal = partyBalObj ? partyBalObj.balance : Number(foundParty?.opening_balance || 0);
          setBalance(currentBal);

          // Sales for this party
          const pSales: PartyInsightSale[] = saleRows
            .filter((inv) => String(inv.party_id) === partyId)
            .sort((a, b) => String(b.invoice_date || "").localeCompare(String(a.invoice_date || "")))
            .slice(0, 12)
            .map((s) => ({
              id: String(s.id),
              invoice_no: String(s.invoice_no || s.id),
              invoice_date: String(s.invoice_date || ""),
              grand_total: Number(s.grand_total || 0),
              amount_paid: Number(s.amount_paid || 0),
              payment_type: String(s.payment_type || "credit"),
            }));
          setSales(pSales);

          // Recoveries for this party
          const pRecs: PartyInsightRecovery[] = voucherRows
            .filter((v) => {
              const t = String(v.voucher_type || v.type || v.entity_type || "");
              const isRec = t === "recovery" || t === "cash_receipt" || t === "receipt" || !t;
              return isRec && String(v.party_id) === partyId;
            })
            .sort((a, b) =>
              String(b.recovery_date || b.voucher_date || b.doc_date || "").localeCompare(
                String(a.recovery_date || a.voucher_date || a.doc_date || ""),
              ),
            )
            .slice(0, 10)
            .map((v) => ({
              id: String(v.id),
              recovery_date: String(v.recovery_date || v.voucher_date || v.doc_date || ""),
              amount: Number(v.amount ?? v.total_amount ?? v.grand_total ?? 0),
              receipt_no: v.receipt_no ? String(v.receipt_no) : (v.voucher_no ? String(v.voucher_no) : null),
              narration: v.narration ? String(v.narration) : null,
            }));
          setRecoveries(pRecs);

          // Product breakdown
          const pMap = new Map<string, PartyInsightProduct>();
          for (const inv of saleRows.filter((s) => String(s.party_id) === partyId)) {
            const rawLines =
              (Array.isArray(inv.lines) && inv.lines) ||
              (Array.isArray(inv.items) && inv.items) ||
              [];

            for (const line of rawLines as Record<string, unknown>[]) {
              const code = String(line.product_code || "");
              const name = String(line.product_name || code || "Item");
              const key = code || name;
              const prev = pMap.get(key) || {
                code,
                name,
                qty: 0,
                amount: 0,
                lastRate: Number(line.rate || line.sale_price || 0),
              };
              prev.qty += Number(line.qty || 0);
              prev.amount += Number(line.amount || 0);
              if (Number(line.rate || line.sale_price || 0) > 0) {
                prev.lastRate = Number(line.rate || line.sale_price);
              }
              pMap.set(key, prev);
            }
          }
          const topProdList = Array.from(pMap.values())
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 8);
          setProducts(topProdList);
        } catch (err) {
          console.error("Failed to load offline party insights:", err);
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      // Online: if initial props were not provided, fetch from Supabase
      if (!initialParty) {
        try {
          const supabase = createClient();
          const today = new Date().toISOString().slice(0, 10);

          const { data: pData } = await supabase
            .from("parties")
            .select("*")
            .eq("company_id", companyId)
            .eq("id", partyId)
            .maybeSingle();

          if (cancelled) return;
          if (pData) setParty(pData as Party);

          const [
            { data: balData },
            { data: sData },
            { data: rData },
            { data: topProdsData },
          ] = await Promise.all([
            supabase.rpc("get_party_balance", {
              p_company_id: companyId,
              p_party_id: partyId,
              p_as_of: today,
            }),
            supabase
              .from("sale_invoices")
              .select("id, invoice_no, invoice_date, grand_total, amount_paid, payment_type")
              .eq("company_id", companyId)
              .eq("party_id", partyId)
              .eq("status", "posted")
              .order("invoice_date", { ascending: false })
              .limit(12),
            supabase
              .from("recoveries")
              .select("id, recovery_date, amount, receipt_no, narration")
              .eq("company_id", companyId)
              .eq("party_id", partyId)
              .order("recovery_date", { ascending: false })
              .limit(10),
            supabase
              .from("sale_invoice_items")
              .select(
                "product_code, product_name, qty, rate, amount, sale_invoices!inner(company_id, party_id, status)",
              )
              .eq("sale_invoices.company_id", companyId)
              .eq("sale_invoices.party_id", partyId)
              .eq("sale_invoices.status", "posted")
              .limit(200),
          ]);

          if (cancelled) return;

          setBalance(Number(balData || 0));
          setSales((sData || []) as PartyInsightSale[]);
          setRecoveries((rData || []) as PartyInsightRecovery[]);

          const prodMap = new Map<string, PartyInsightProduct>();
          for (const row of (topProdsData || []) as Array<{
            product_code: string;
            product_name: string;
            qty: number;
            rate: number;
            amount: number;
          }>) {
            const key = row.product_code || row.product_name;
            const prev = prodMap.get(key) || {
              code: row.product_code,
              name: row.product_name,
              qty: 0,
              amount: 0,
              lastRate: Number(row.rate || 0),
            };
            prev.qty += Number(row.qty || 0);
            prev.amount += Number(row.amount || 0);
            prev.lastRate = Number(row.rate || 0);
            prodMap.set(key, prev);
          }
          setProducts(
            Array.from(prodMap.values())
              .sort((a, b) => b.amount - a.amount)
              .slice(0, 8),
          );
        } catch (err) {
          console.error("Failed to load online party insights:", err);
        } finally {
          if (!cancelled) setLoading(false);
        }
      } else {
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    companyId,
    partyId,
    isOnline,
    initialParty,
    initialBalance,
    initialSales,
    initialRecoveries,
    initialProducts,
  ]);

  return {
    party,
    balance,
    sales,
    recoveries,
    products,
    loading,
  };
}
