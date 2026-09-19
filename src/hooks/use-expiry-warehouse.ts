"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { getCachedRows } from "@/lib/offline/local-db";
import {
  buildPaginationMeta,
  parsePaginationParams,
  type PaginationMeta,
} from "@/lib/pagination";
import {
  documentListConfigs,
  fetchDocumentList,
  type DocumentListRow,
  type DocumentListSummary,
} from "@/lib/queries/documents";
import { fetchExpiryStock, type ExpiryStockRow } from "@/lib/queries/expiry";
import { createClient } from "@/lib/supabase/client";
import type { Company, Party, Product, Warehouse } from "@/lib/types/database";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ExpiryTab = "stock" | "receipts" | "claims";

export type ExpiryStats = {
  productsOnHand: number;
  onHandQty: number;
  onHandValue: number;
  openClaimsCount: number;
  monthCredit: number;
};

export type ExpiryWarehouseData = {
  stock: ExpiryStockRow[];
  receipts: {
    rows: DocumentListRow[];
    pagination: PaginationMeta;
    summary: DocumentListSummary;
  };
  claims: {
    rows: DocumentListRow[];
    pagination: PaginationMeta;
    summary: DocumentListSummary;
  };
  stats: ExpiryStats;
};

const EMPTY_SUMMARY: DocumentListSummary = {
  totalAmount: 0,
  cashTotal: 0,
  creditTotal: 0,
  trend: [],
  mix: [],
};

const EMPTY_DATA: ExpiryWarehouseData = {
  stock: [],
  receipts: {
    rows: [],
    pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1, from: 0, to: 0 },
    summary: EMPTY_SUMMARY,
  },
  claims: {
    rows: [],
    pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1, from: 0, to: 0 },
    summary: EMPTY_SUMMARY,
  },
  stats: {
    productsOnHand: 0,
    onHandQty: 0,
    onHandValue: 0,
    openClaimsCount: 0,
    monthCredit: 0,
  },
};

export function useExpiryWarehouse({
  company,
  initialData,
  initialParties = [],
  initialProducts = [],
  initialWarehouses = [],
  initialOffline = false,
}: {
  company: Company;
  initialData?: ExpiryWarehouseData | null;
  initialParties?: Party[];
  initialProducts?: Product[];
  initialWarehouses?: Warehouse[];
  initialOffline?: boolean;
}) {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab");
  const activeTab: ExpiryTab =
    tabParam === "receipts" || tabParam === "claims" ? tabParam : "stock";

  const [data, setData] = useState<ExpiryWarehouseData>(initialData || EMPTY_DATA);
  const [parties, setParties] = useState<Party[]>(initialParties);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialWarehouses);
  const [loading, setLoading] = useState(!initialData);
  const isFirstMount = useRef(true);

  const spRecord = useMemo(() => {
    const rec: Record<string, string | string[] | undefined> = {};
    searchParams.forEach((v, k) => {
      rec[k] = v;
    });
    return rec;
  }, [searchParams]);

  const load = useCallback(async () => {
    if (!company?.id) return;

    if (!isOnline) {
      setLoading(true);
      try {
        const { hasLocalSqlite, localListMaster, localListByEntity } = await import(
          "@/lib/offline/sqlite-client"
        );

        let partyRows: Record<string, unknown>[] = [];
        let productRows: Record<string, unknown>[] = [];
        let warehouseRows: Record<string, unknown>[] = [];
        let receiptRows: Record<string, unknown>[] = [];
        let claimRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [pts, prods, whs, recs, clms] = await Promise.all([
            localListMaster("parties", company.id),
            localListMaster("products", company.id),
            localListMaster("warehouses", company.id),
            localListByEntity(company.id, "expiry_receipt"),
            localListByEntity(company.id, "expiry_claim"),
          ]);
          partyRows = pts.rows || [];
          productRows = prods.rows || [];
          warehouseRows = whs.rows || [];
          receiptRows = recs.rows || [];
          claimRows = clms.rows || [];
        }

        if (!partyRows.length) partyRows = await getCachedRows("parties", company.id);
        if (!productRows.length) productRows = await getCachedRows("products", company.id);
        if (!warehouseRows.length) warehouseRows = await getCachedRows("warehouses", company.id);
        if (!receiptRows.length) receiptRows = await getCachedRows("expiry_receipts", company.id);
        if (!claimRows.length) claimRows = await getCachedRows("expiry_claims", company.id);

        const pts = partyRows as unknown as Party[];
        const prods = productRows as unknown as Product[];
        const whs = warehouseRows as unknown as Warehouse[];
        setParties(pts);
        setProducts(prods);
        setWarehouses(whs);

        // 1. Calculate stock on-hand from receipts and claims
        const stockMap = new Map<string, number>();

        for (const r of receiptRows) {
          const payload = (r.payload as Record<string, unknown> | undefined) || r;
          const rawLines =
            (Array.isArray(payload.items) && payload.items) ||
            (Array.isArray(payload.lines) && payload.lines) ||
            (Array.isArray(r.lines) && r.lines) ||
            [];
          for (const line of rawLines as Record<string, unknown>[]) {
            const pid = String(line.product_id || "");
            if (pid) {
              const current = stockMap.get(pid) || 0;
              stockMap.set(pid, current + Number(line.qty || 0));
            }
          }
        }

        for (const c of claimRows) {
          const payload = (c.payload as Record<string, unknown> | undefined) || c;
          const rawLines =
            (Array.isArray(payload.items) && payload.items) ||
            (Array.isArray(payload.lines) && payload.lines) ||
            (Array.isArray(c.lines) && c.lines) ||
            [];
          for (const line of rawLines as Record<string, unknown>[]) {
            const pid = String(line.product_id || "");
            if (pid) {
              const current = stockMap.get(pid) || 0;
              stockMap.set(pid, current - Number(line.qty || 0));
            }
          }
        }

        const calculatedStock: ExpiryStockRow[] = [];
        for (const [productId, qty] of stockMap.entries()) {
          if (qty > 0) {
            const prod = prods.find((p) => p.id === productId);
            const rate = Number(prod?.purchase_rate || prod?.retail_rate || 0);
            calculatedStock.push({
              product_id: productId,
              product_code: prod?.code || "",
              product_name: prod?.name_en || "",
              qty,
              rate,
              amount: qty * rate,
            });
          }
        }
        calculatedStock.sort((a, b) => b.qty - a.qty);

        // 2. Build receipts DocumentList
        const q = (searchParams.get("q") || "").toLowerCase().trim();
        const warehouseFilter = searchParams.get("warehouse") || "";

        const allReceiptRows: DocumentListRow[] = receiptRows.map((r) => {
          const party = pts.find((p) => p.id === String(r.party_id));
          return {
            id: String(r.id),
            docNo: String(r.receipt_no || r.doc_no || r.id),
            date: String(r.receipt_date || r.doc_date || ""),
            partyLabel: party
              ? `${party.party_code} — ${party.name_en}`
              : String(r.party_name || "—"),
            warehouseLabel: "—",
            total: Number(r.grand_total ?? r.amount ?? 0),
            href: `/inventory/expiry/receipts/${r.id}`,
            table: "expiry_receipts",
            linesTable: "expiry_receipt_items",
            linesFk: "receipt_id",
            extra:
              r.period_from && r.period_to
                ? [
                    {
                      label: "Sold between",
                      value: `${r.period_from} → ${r.period_to}`,
                    },
                  ]
                : [],
          };
        });

        const filteredReceipts = allReceiptRows.filter((row) => {
          if (q) {
            const text = `${row.docNo} ${row.partyLabel}`.toLowerCase();
            if (!text.includes(q)) return false;
          }
          return true;
        });

        const receiptPaginationParams = parsePaginationParams(spRecord);
        const receiptPagination = buildPaginationMeta(
          filteredReceipts.length,
          receiptPaginationParams,
        );
        const receiptFrom = receiptPagination.from ? receiptPagination.from - 1 : 0;
        const pagedReceipts = filteredReceipts.slice(
          receiptFrom,
          receiptPagination.to,
        );
        const receiptTotalAmount = filteredReceipts.reduce(
          (s, r) => s + r.total,
          0,
        );

        // 3. Build claims DocumentList
        const allClaimRows: DocumentListRow[] = claimRows.map((r) => {
          const party = pts.find((p) => p.id === String(r.party_id));
          const wh = whs.find((w) => w.id === String(r.warehouse_id));
          return {
            id: String(r.id),
            docNo: String(r.claim_no || r.doc_no || r.id),
            date: String(r.claim_date || r.doc_date || ""),
            partyLabel: party
              ? `${party.party_code} — ${party.name_en}`
              : String(r.party_name || "—"),
            warehouseLabel: wh?.name || String(r.warehouse_name || "—"),
            total: Number(r.grand_total ?? r.amount ?? 0),
            href: `/inventory/expiry/claims/${r.id}`,
            table: "expiry_claims",
            linesTable: "expiry_claim_items",
            linesFk: "claim_id",
            extra: [
              {
                label: "Claim status",
                value: String(r.claim_status || "open"),
              },
            ],
          };
        });

        const filteredClaims = allClaimRows.filter((row) => {
          if (warehouseFilter) {
            const wh = whs.find((w) => w.name === row.warehouseLabel);
            if (!wh || wh.id !== warehouseFilter) return false;
          }
          if (q) {
            const text = `${row.docNo} ${row.partyLabel} ${row.warehouseLabel}`.toLowerCase();
            if (!text.includes(q)) return false;
          }
          return true;
        });

        const claimPaginationParams = parsePaginationParams(spRecord);
        const claimPagination = buildPaginationMeta(
          filteredClaims.length,
          claimPaginationParams,
        );
        const claimFrom = claimPagination.from ? claimPagination.from - 1 : 0;
        const pagedClaims = filteredClaims.slice(claimFrom, claimPagination.to);
        const claimTotalAmount = filteredClaims.reduce((s, r) => s + r.total, 0);

        // 4. Calculate stats
        const now = new Date();
        const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const monthReceiptsTotal = receiptRows.reduce((sum, r) => {
          const d = String(r.receipt_date || r.doc_date || "");
          if (d.startsWith(monthPrefix)) {
            return sum + Number(r.grand_total ?? r.amount ?? 0);
          }
          return sum;
        }, 0);

        const openClaimsCount = claimRows.filter(
          (c) => String(c.claim_status || "open") === "open",
        ).length;

        const onHandQty = calculatedStock.reduce((s, r) => s + r.qty, 0);
        const onHandValue = calculatedStock.reduce((s, r) => s + r.amount, 0);

        setData({
          stock: calculatedStock,
          receipts: {
            rows: pagedReceipts,
            pagination: receiptPagination,
            summary: {
              totalAmount: receiptTotalAmount,
              cashTotal: 0,
              creditTotal: receiptTotalAmount,
              trend: [],
              mix: [],
            },
          },
          claims: {
            rows: pagedClaims,
            pagination: claimPagination,
            summary: {
              totalAmount: claimTotalAmount,
              cashTotal: 0,
              creditTotal: claimTotalAmount,
              trend: [],
              mix: [],
            },
          },
          stats: {
            productsOnHand: calculatedStock.length,
            onHandQty,
            onHandValue,
            openClaimsCount,
            monthCredit: monthReceiptsTotal,
          },
        });
      } catch (err) {
        console.error("Failed to load offline expiry warehouse data:", err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Online fetch
    setLoading(true);
    try {
      const supabase = createClient();
      const monthStart = new Date();
      monthStart.setDate(1);
      const monthFrom = monthStart.toISOString().slice(0, 10);

      const [
        stock,
        receipts,
        claims,
        monthReceiptsRes,
        openClaimsRes,
        partyRes,
        prodRes,
        whRes,
      ] = await Promise.all([
        fetchExpiryStock(supabase, company.id),
        fetchDocumentList(
          supabase,
          company.id,
          spRecord,
          documentListConfigs.expiryReceipt,
        ),
        fetchDocumentList(
          supabase,
          company.id,
          spRecord,
          documentListConfigs.expiryClaim,
        ),
        supabase
          .from("expiry_receipts")
          .select("grand_total")
          .eq("company_id", company.id)
          .gte("receipt_date", monthFrom),
        supabase
          .from("expiry_claims")
          .select("id", { count: "exact", head: true })
          .eq("company_id", company.id)
          .eq("claim_status", "open"),
        supabase
          .from("parties")
          .select("*")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .order("name_en"),
        supabase
          .from("products")
          .select("*")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .order("code"),
        supabase
          .from("warehouses")
          .select("*")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .order("name"),
      ]);

      setParties((partyRes.data as Party[]) || []);
      setProducts((prodRes.data as Product[]) || []);
      setWarehouses((whRes.data as Warehouse[]) || []);

      const onHandQty = stock.reduce((s, r) => s + r.qty, 0);
      const onHandValue = stock.reduce((s, r) => s + r.amount, 0);
      const monthCredit = (monthReceiptsRes.data || []).reduce(
        (s, r) => s + Number(r.grand_total || 0),
        0,
      );

      setData({
        stock,
        receipts,
        claims,
        stats: {
          productsOnHand: stock.length,
          onHandQty,
          onHandValue,
          openClaimsCount: openClaimsRes.count || 0,
          monthCredit,
        },
      });
    } catch (err) {
      console.error("Failed to load online expiry warehouse data:", err);
    } finally {
      setLoading(false);
    }
  }, [company?.id, isOnline, searchParams, spRecord]);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (initialData && isOnline) return;
    }
    void load();
  }, [load, initialData, isOnline]);

  return {
    ...data,
    activeTab,
    parties,
    products,
    warehouses,
    loading,
    refetch: load,
  };
}
