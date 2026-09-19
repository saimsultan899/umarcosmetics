"use client";

import { PartiesTable } from "@/components/tables/parties-table";
import { ProductsTable } from "@/components/tables/products-table";
import {
  WarehousesList,
  type WarehouseListStats,
} from "@/components/tables/warehouses-list";
import {
  SalesmenTable,
  type SalesmanListRow,
} from "@/components/tables/salesmen-table";
import { ExpensesTable } from "@/components/tables/expenses-table";
import { VouchersTable } from "@/components/tables/vouchers-table";
import { DocumentListTable } from "@/components/tables/document-list-table";
import { GatePassesTable } from "@/components/tables/gate-passes-table";
import { LoadSheetsTable } from "@/components/tables/load-sheets-table";
import { TransfersTable } from "@/components/tables/transfers-table";
import { RecoveriesTable } from "@/components/tables/recoveries-table";
import { LocationListsManager } from "@/components/forms/location-lists-manager";
import { PartyForm } from "@/components/forms/party-form";
import { ProductForm } from "@/components/forms/product-form";
import { WarehouseForm } from "@/components/forms/warehouse-form";
import { ExpenseForm } from "@/components/vouchers/expense-form";
import { JournalVoucherForm } from "@/components/vouchers/journal-form";
import { RecoveryForm } from "@/components/vouchers/recovery-form";
import { CashVoucherForm } from "@/components/vouchers/voucher-lines-form";
import { ReturnForm } from "@/components/trading/return-form";
import { GatePassForm } from "@/components/trading/gate-pass-form";
import { LoadSheetForm } from "@/components/trading/load-sheet-form";
import { StockTransferForm } from "@/components/trading/stock-transfer-form";
import { SalesmanForm } from "@/components/salesman/salesman-form";
import { ExpiryClaimForm } from "@/components/expiry/expiry-claim-form";
import { ExpiryReceiptForm } from "@/components/expiry/expiry-receipt-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useOfflineData } from "@/hooks/use-offline-data";
import { emptyDocumentSummary } from "@/lib/offline/local-list-meta";
import { offlineStockSnapshot } from "@/lib/offline/offline-reports";
import type { CacheStoreName } from "@/lib/offline/local-db";
import type { DocumentListRow } from "@/lib/queries/documents";
import type { ExpenseRow } from "@/lib/queries/expenses";
import type { GatePassListRow } from "@/lib/queries/gate-passes";
import type { LoadSheetRow } from "@/lib/queries/load-sheets";
import type { PartyListStats } from "@/lib/queries/parties";
import type { ProductListStats } from "@/lib/queries/products";
import type { StockTransferRow } from "@/lib/queries/stock-transfers";
import type { VoucherRow } from "@/lib/queries/vouchers";
import type { RecoveryRow } from "@/lib/queries/recoveries";
import type { PaginationMeta } from "@/lib/pagination";
import type { Party, PartySubtype, PartyType, Product, Warehouse } from "@/lib/types/database";
import { migrateLegacyLocalDocNos } from "@/lib/offline/offline-submit";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export type OfflineModuleKind =
  | "parties"
  | "products"
  | "warehouses"
  | "salesmen"
  | "sale_returns"
  | "purchase_returns"
  | "expenses"
  | "cash_receipt"
  | "cash_payment"
  | "journal"
  | "gate_passes"
  | "load_sheets"
  | "stock_transfers"
  | "expiry_receipts"
  | "expiry_claims"
  | "recoveries";

type Meta = {
  title: string;
  description: string;
  store: CacheStoreName;
  addLabel: string;
  addTitle: string;
  addDescription: string;
};

const META: Record<OfflineModuleKind, Meta> = {
  parties: {
    title: "All parties",
    description: "Every account in one list — customers, vendors, and ledger heads.",
    store: "parties",
    addLabel: "Add party",
    addTitle: "Add party",
    addDescription: "Create a customer, vendor, or ledger head",
  },
  products: {
    title: "Products",
    description:
      "Inventory masters with rates, packing, and reorder levels. Expired customer returns are held in Expiry Warehouse, not saleable stock.",
    store: "products",
    addLabel: "Add product",
    addTitle: "Add product",
    addDescription: "Create a catalog item with rates and packing",
  },
  warehouses: {
    title: "Warehouses",
    description: "Companies / brand locations that hold stock.",
    store: "warehouses",
    addLabel: "Add warehouse",
    addTitle: "Add warehouse",
    addDescription: "Create a company stock location",
  },
  salesmen: {
    title: "Salesmen",
    description: "Field staff used on sales and recoveries.",
    store: "salesmen",
    addLabel: "Add salesman",
    addTitle: "Add salesman",
    addDescription: "Create a salesman name for invoices",
  },
  sale_returns: {
    title: "Sale Return",
    description: "Receive saleable returned goods. Expired items go to Expiry Warehouse instead.",
    store: "sale_returns",
    addLabel: "New return",
    addTitle: "New sale return",
    addDescription: "Restore stock from a customer return",
  },
  purchase_returns: {
    title: "Purchase Return",
    description: "Return goods to vendors and adjust stock.",
    store: "purchase_returns",
    addLabel: "New return",
    addTitle: "New purchase return",
    addDescription: "Return stock to a vendor",
  },
  expenses: {
    title: "Expenses",
    description: "Record daily operating expenses.",
    store: "expenses",
    addLabel: "New expense",
    addTitle: "New expense",
    addDescription: "Post expense lines",
  },
  cash_receipt: {
    title: "Cash Receipt",
    description: "Receive cash against parties / recoveries.",
    store: "vouchers",
    addLabel: "New receipt",
    addTitle: "New cash receipt",
    addDescription: "Post cash receipt voucher",
  },
  cash_payment: {
    title: "Cash Payment",
    description: "Pay cash to parties / vendors.",
    store: "vouchers",
    addLabel: "New payment",
    addTitle: "New cash payment",
    addDescription: "Post cash payment voucher",
  },
  journal: {
    title: "Journal Voucher",
    description: "Transfer between ledger heads.",
    store: "vouchers",
    addLabel: "New journal",
    addTitle: "New journal voucher",
    addDescription: "Post journal lines",
  },
  gate_passes: {
    title: "Gate Pass",
    description: "Incoming company load — match goods here, then post purchase to add stock.",
    store: "gate_passes",
    addLabel: "New gate pass",
    addTitle: "New gate pass",
    addDescription: "Record incoming load",
  },
  load_sheets: {
    title: "Load Sheet",
    description: "Van load sheets for field dispatch.",
    store: "load_sheets",
    addLabel: "New load sheet",
    addTitle: "New load sheet",
    addDescription: "Create dispatch load",
  },
  stock_transfers: {
    title: "Company transfer",
    description: "Move stock between companies / brand locations",
    store: "stock_transfers",
    addLabel: "New transfer",
    addTitle: "New company transfer",
    addDescription: "Move stock between companies",
  },
  expiry_receipts: {
    title: "Expiry warehouse",
    description: "Expired customer returns held offline.",
    store: "expiry_receipts",
    addLabel: "New receipt",
    addTitle: "New expiry receipt",
    addDescription: "Receive expired goods",
  },
  expiry_claims: {
    title: "Expiry vendor claims",
    description: "Send expiry stock to vendors offline.",
    store: "expiry_claims",
    addLabel: "New claim",
    addTitle: "New expiry claim",
    addDescription: "Claim expired goods to vendor",
  },
  recoveries: {
    title: "Recovery",
    description: "Collect cash from shops.",
    store: "vouchers",
    addLabel: "New recovery",
    addTitle: "New recovery",
    addDescription: "Post recovery collection",
  },
};

function paginate<T>(items: T[], page: number, pageSize: number): { paged: T[]; meta: PaginationMeta } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const validPage = Math.min(Math.max(1, page), totalPages);
  const from = total ? (validPage - 1) * pageSize : 0;
  const to = Math.min(total, from + pageSize);
  const paged = items.slice(from, to);
  return {
    paged,
    meta: {
      page: validPage,
      pageSize: pageSize as 12 | 24 | 48 | 96,
      total,
      totalPages,
      from: total ? from + 1 : 0,
      to,
    },
  };
}

/**
 * Offline pages that reuse the same online tables/forms/headings with full search, filter, and pagination support.
 */
export function OfflineModulePage({
  kind,
  companyId,
  organizationId,
  companyName = "Company",
}: {
  kind: OfflineModuleKind;
  companyId: string;
  organizationId: string;
  companyName?: string;
}) {
  const meta = META[kind];
  const searchParams = useSearchParams();

  const q = (searchParams.get("q") || "").toLowerCase().trim();
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const rawSize = Number(searchParams.get("pageSize") || 24);
  const pageSize = [12, 24, 48, 96].includes(rawSize) ? (rawSize as 12 | 24 | 48 | 96) : 24;

  const typeParam = searchParams.get("type") || "all";
  const viewParam = searchParams.get("view") || "";
  const warehouseParam = searchParams.get("warehouse") || "";
  const cityParam = searchParams.get("city") || "";
  const sectorParam = searchParams.get("sector") || "";
  const salesmanParam = searchParams.get("salesman") || "";

  const { data: rows, loading, refetch } = useOfflineData(meta.store, companyId);
  const { data: parties } = useOfflineData<Party>("parties", companyId);
  const { data: products } = useOfflineData<Product>("products", companyId);
  const { data: warehouses } = useOfflineData<Warehouse>("warehouses", companyId);
  const { data: salesmenRows } = useOfflineData("salesmen", companyId);

  const [stockBalances, setStockBalances] = useState<
    Array<{ product_id: string; warehouse_id: string; qty: number; purchase_rate?: number }>
  >([]);

  useEffect(() => {
    void migrateLegacyLocalDocNos(companyId).then(() => {
      void refetch();
    });
  }, [companyId, refetch]);

  useEffect(() => {
    let cancelled = false;
    void offlineStockSnapshot(companyId).then((data) => {
      if (!cancelled) {
        setStockBalances(
          data.map((r) => ({
            product_id: String(r.product_id || ""),
            warehouse_id: String(r.warehouse_id || ""),
            qty: Number(r.qty || 0),
          })),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const salesmen = useMemo(
    () =>
      salesmenRows.map((s) => ({
        user_id: String(s.id),
        full_name: String(s.full_name || s.name || "") || null,
        phone: s.phone == null ? null : String(s.phone),
      })),
    [salesmenRows],
  );

  const vendors = useMemo(
    () =>
      parties.filter(
        (p) =>
          p.party_subtype === "supplier" ||
          p.party_subtype === "both" ||
          p.party_type === "PARTY",
      ),
    [parties],
  );

  const cityOptions = useMemo(
    () =>
      Array.from(
        new Set(
          parties
            .map((p) => p.city || p.head)
            .filter(Boolean) as string[],
        ),
      ).sort(),
    [parties],
  );

  const sectorOptions = useMemo(
    () =>
      Array.from(
        new Set(
          parties
            .map((p) => p.route)
            .filter(Boolean) as string[],
        ),
      ).sort(),
    [parties],
  );

  const partyList = parties as Party[];
  const productList = products as Product[];
  const warehouseList = warehouses as Warehouse[];

  // Dynamic meta according to view/type for parties
  const dynamicMeta = useMemo(() => {
    if (kind === "parties") {
      if (viewParam === "ledger") {
        return {
          title: "Chart of Accounts",
          description: "Ledger heads for bookkeeping — Assets, Capital, Expenses, and Income.",
          addLabel: "Add ledger head",
          addTitle: "Add ledger head",
          addDescription: "Create an accounting head used in vouchers and journals",
          defaultSubtype: undefined as PartySubtype | undefined,
          defaultPartyType: "EXPENSES" as PartyType,
          showLocations: false,
        };
      }
      if (typeParam === "customer") {
        return {
          title: "Customers / Shops",
          description: "Retail and wholesale customers you sell to.",
          addLabel: "Add customer",
          addTitle: "Add customer",
          addDescription: "Create a customer or shop for sales invoices",
          defaultSubtype: "customer" as PartySubtype,
          defaultPartyType: "PARTY" as PartyType,
          showLocations: true,
        };
      }
      if (typeParam === "supplier") {
        return {
          title: "Vendors",
          description: "Suppliers for purchases, gate pass, and stock inward.",
          addLabel: "Add vendor",
          addTitle: "Add vendor",
          addDescription: "Create a vendor for purchases and gate pass",
          defaultSubtype: "supplier" as PartySubtype,
          defaultPartyType: "PARTY" as PartyType,
          showLocations: true,
        };
      }
      return {
        title: "All parties",
        description: "Every account in one list — customers, vendors, and ledger heads.",
        addLabel: "Add party",
        addTitle: "Add party",
        addDescription: "Create a customer, vendor, or ledger head",
        defaultSubtype: undefined as PartySubtype | undefined,
        defaultPartyType: "PARTY" as PartyType,
        showLocations: true,
      };
    }
    return {
      title: meta.title,
      description: meta.description,
      addLabel: meta.addLabel,
      addTitle: meta.addTitle,
      addDescription: meta.addDescription,
      defaultSubtype: undefined,
      defaultPartyType: undefined,
      showLocations: false,
    };
  }, [kind, typeParam, viewParam, meta]);

  // General filtered voucher rows
  const voucherFilteredRows = useMemo(() => {
    if (kind === "cash_receipt") {
      return rows.filter((r) => {
        const t = String(r.voucher_type || r.type || r.entity_type || "");
        return t === "cash_receipt" || t === "receipt" || t === "CR";
      });
    }
    if (kind === "recoveries") {
      return rows.filter((r) => {
        const t = String(r.voucher_type || r.type || r.entity_type || "");
        return t === "recovery" || t === "cash_receipt" || t === "CR";
      });
    }
    if (kind === "cash_payment") {
      return rows.filter((r) => {
        const t = String(r.voucher_type || r.type || r.entity_type || "");
        return t === "cash_payment" || t === "payment" || t === "CP";
      });
    }
    if (kind === "journal") {
      return rows.filter((r) => {
        const t = String(r.voucher_type || r.type || r.entity_type || "");
        return t === "journal_voucher" || t === "journal" || t === "JV";
      });
    }
    return rows;
  }, [rows, kind]);

  const createForm = (() => {
    switch (kind) {
      case "parties":
        return (
          <PartyForm
            companyId={companyId}
            organizationId={organizationId}
            cityOptions={cityOptions}
            sectorOptions={sectorOptions}
            defaultSubtype={dynamicMeta.defaultSubtype}
            defaultPartyType={dynamicMeta.defaultPartyType}
            onDone={refetch}
          />
        );
      case "products":
        return (
          <ProductForm
            companyId={companyId}
            organizationId={organizationId}
            warehouses={warehouses}
            onDone={refetch}
          />
        );
      case "warehouses":
        return (
          <WarehouseForm
            companyId={companyId}
            organizationId={organizationId}
            onDone={refetch}
          />
        );
      case "salesmen":
        return (
          <SalesmanForm
            companyId={companyId}
            organizationId={organizationId}
            onDone={refetch}
          />
        );
      case "sale_returns":
        return (
          <ReturnForm
            kind="sale"
            companyId={companyId}
            organizationId={organizationId}
            parties={parties}
            products={products}
            warehouses={warehouses}
            onDone={refetch}
          />
        );
      case "purchase_returns":
        return (
          <ReturnForm
            kind="purchase"
            companyId={companyId}
            organizationId={organizationId}
            parties={parties}
            products={products}
            warehouses={warehouses}
            onDone={refetch}
          />
        );
      case "expenses":
        return (
          <ExpenseForm
            companyId={companyId}
            organizationId={organizationId}
            salesmen={salesmen}
            warehouses={warehouses}
            vendors={vendors}
            onDone={refetch}
          />
        );
      case "cash_receipt":
        return (
          <CashVoucherForm
            kind="CR"
            companyId={companyId}
            organizationId={organizationId}
            parties={parties}
            onDone={refetch}
          />
        );
      case "cash_payment":
        return (
          <CashVoucherForm
            kind="CP"
            companyId={companyId}
            organizationId={organizationId}
            parties={parties}
            onDone={refetch}
          />
        );
      case "journal":
        return (
          <JournalVoucherForm
            companyId={companyId}
            organizationId={organizationId}
            parties={parties}
            onDone={refetch}
          />
        );
      case "recoveries":
        return (
          <RecoveryForm
            companyId={companyId}
            organizationId={organizationId}
            parties={parties}
            salesmen={salesmen}
            onDone={refetch}
          />
        );
      case "gate_passes":
        return (
          <GatePassForm
            companyId={companyId}
            organizationId={organizationId}
            companyName={companyName}
            parties={parties}
            products={products}
            warehouses={warehouses}
            onDone={refetch}
          />
        );
      case "load_sheets":
        return (
          <LoadSheetForm
            companyId={companyId}
            organizationId={organizationId}
            products={products}
            warehouses={warehouses}
            salesmen={salesmen}
            onDone={refetch}
          />
        );
      case "stock_transfers":
        return (
          <StockTransferForm
            companyId={companyId}
            organizationId={organizationId}
            products={products}
            warehouses={warehouses}
            onDone={refetch}
          />
        );
      case "expiry_receipts":
        return (
          <ExpiryReceiptForm
            companyId={companyId}
            organizationId={organizationId}
            parties={parties}
            products={products}
            onDone={refetch}
          />
        );
      case "expiry_claims":
        return (
          <ExpiryClaimForm
            companyId={companyId}
            organizationId={organizationId}
            parties={parties}
            warehouses={warehouses}
            stock={[]}
            onDone={refetch}
          />
        );
      default:
        return null;
    }
  })();

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <PageHeading title={dynamicMeta.title} description={dynamicMeta.description} />
        <PageSkeleton />
      </div>
    );
  }

  let body: React.ReactNode = null;

  if (kind === "parties") {
    // Filter parties matching online logic
    const filteredParties = partyList.filter((p) => {
      if (viewParam === "ledger") {
        if (
          p.party_type !== "EXPENSES" &&
          p.party_type !== "ASSETS" &&
          p.party_type !== "CAPITAL" &&
          p.party_type !== "INCOME"
        ) {
          return false;
        }
      } else {
        if (typeParam === "customer") {
          if (p.party_subtype !== "customer" && p.party_subtype !== "both") return false;
        } else if (typeParam === "supplier") {
          if (p.party_subtype !== "supplier" && p.party_subtype !== "both") return false;
        } else if (typeParam === "both") {
          if (p.party_subtype !== "both") return false;
        } else if (typeParam === "other") {
          if (p.party_subtype !== "other") return false;
        } else if (typeParam === "credit") {
          if (Number(p.credit_limit || 0) <= 0) return false;
        }
      }
      if (cityParam && (p.city || p.head) !== cityParam) return false;
      if (sectorParam && p.route !== sectorParam) return false;
      if (q) {
        const text = `${p.party_code || ""} ${p.name_en || ""} ${p.name_ur || ""} ${p.mobile || ""} ${p.phone || ""} ${p.contact_person || ""} ${p.address || ""} ${p.city || ""} ${p.route || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const { paged, meta: pagMeta } = paginate(filteredParties, page, pageSize);

    const isLedgerMode = viewParam === "ledger";
    const customersCount = partyList.filter(
      (p) => p.party_subtype === "customer" || p.party_subtype === "both",
    ).length;
    const suppliersCount = partyList.filter(
      (p) => p.party_subtype === "supplier" || p.party_subtype === "both",
    ).length;

    const stats: PartyListStats = {
      total: partyList.length,
      customers: customersCount,
      suppliers: suppliersCount,
      withCreditLimit: partyList.filter((p) => Number(p.credit_limit) > 0).length,
      subtypeMix: [
        { name: "Customers", value: customersCount },
        { name: "Vendors", value: suppliersCount },
      ],
      ledgerMix: [],
      cityBars: cityOptions.map((city) => ({
        name: city,
        value: partyList.filter((p) => p.city === city || p.head === city).length,
      })),
      mode: isLedgerMode ? "ledger" : "all",
    };

    body = (
      <PartiesTable
        parties={paged}
        pagination={pagMeta}
        stats={stats}
        companyId={companyId}
        organizationId={organizationId}
        cityOptions={cityOptions}
        sectorOptions={sectorOptions}
        initialType={typeParam !== "all" ? typeParam : undefined}
      />
    );
  } else if (kind === "products") {
    const qtyByProduct = new Map<string, number>();
    for (const b of stockBalances) {
      qtyByProduct.set(b.product_id, (qtyByProduct.get(b.product_id) || 0) + Number(b.qty || 0));
    }

    const stockValueByCode: Record<string, number> = {};
    const lowStockCodes: string[] = [];
    let totalStockVal = 0;
    let lowStockCount = 0;

    for (const p of productList) {
      const qOnHand = qtyByProduct.get(p.id) || 0;
      const rate = Number(p.purchase_rate || p.retail_rate || 0);
      const val = qOnHand * rate;
      stockValueByCode[p.code] = val;
      totalStockVal += val;
      if (Number(p.reorder_level) > 0 && qOnHand <= Number(p.reorder_level)) {
        lowStockCodes.push(p.code);
        lowStockCount += 1;
      }
    }

    const filteredProducts = productList.filter((p) => {
      if (viewParam === "reorder" && Number(p.reorder_level || 0) <= 0) return false;
      if (warehouseParam && p.default_warehouse_id !== warehouseParam) return false;
      if (q) {
        const text = `${p.code || ""} ${p.name_en || ""} ${p.name_ur || ""} ${p.barcode || ""} ${p.product_type || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const { paged, meta: pagMeta } = paginate(filteredProducts, page, pageSize);

    const warehouseMap = new Map(warehouseList.map((w) => [w.id, w.name]));
    const makerBars = warehouseList.map((w) => ({
      name: w.name,
      value: productList.filter((p) => p.default_warehouse_id === w.id).length,
    }));

    const prodStats: ProductListStats = {
      total: productList.length,
      stockValue: totalStockVal,
      withReorder: productList.filter((p) => Number(p.reorder_level) > 0).length,
      lowStock: lowStockCount,
      makerBars,
      topStock: [],
      health: [],
    };

    body = (
      <ProductsTable
        products={paged}
        pagination={pagMeta}
        stats={prodStats}
        warehouses={warehouseList}
        companyId={companyId}
        organizationId={organizationId}
        stockValueByCode={stockValueByCode}
        lowStockCodes={lowStockCodes}
        initialView={viewParam || undefined}
      />
    );
  } else if (kind === "warehouses") {
    const filteredWarehouses = warehouseList.filter((w) => {
      if (q) {
        const text = `${w.name || ""} ${w.code || ""} ${w.address || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const statsByWarehouse: Record<string, WarehouseListStats> = {};
    for (const w of warehouseList) {
      const assignedProducts = productList.filter((p) => p.default_warehouse_id === w.id);
      let inStock = 0;
      let val = 0;
      for (const p of assignedProducts) {
        const bal = stockBalances.find((b) => b.warehouse_id === w.id && b.product_id === p.id);
        const qty = bal ? Number(bal.qty || 0) : 0;
        if (qty > 0) inStock += 1;
        val += qty * Number(p.purchase_rate || 0);
      }
      statsByWarehouse[w.id] = {
        warehouseId: w.id,
        productCount: assignedProducts.length,
        inStockCount: inStock,
        stockValue: val,
      };
    }

    body = (
      <WarehousesList
        warehouses={filteredWarehouses}
        statsByWarehouse={statsByWarehouse}
        companyId={companyId}
        organizationId={organizationId}
      />
    );
  } else if (kind === "salesmen") {
    const list: SalesmanListRow[] = salesmenRows
      .map((s) => ({
        id: String(s.id),
        full_name: String(s.full_name || s.name || ""),
        phone: s.phone == null ? null : String(s.phone),
        code: s.code == null ? null : String(s.code),
        is_active: s.is_active !== false && s.is_active !== 0,
        user_id: s.user_id == null ? null : String(s.user_id),
        created_at: String(s.created_at || s.updated_at || ""),
        bills: 0,
        sales: 0,
        recoveries: 0,
        recovered: 0,
      }))
      .filter((s) => {
        if (q) {
          const text = `${s.full_name || ""} ${s.phone || ""} ${s.code || ""}`.toLowerCase();
          if (!text.includes(q)) return false;
        }
        return true;
      });

    body = (
      <SalesmenTable
        rows={list}
        companyId={companyId}
        organizationId={organizationId}
      />
    );
  } else if (kind === "expenses") {
    const allExpenses: ExpenseRow[] = voucherFilteredRows.map((r) => ({
      id: String(r.id),
      expense_no: String(r.expense_no || r.doc_no || r.id),
      expense_date: String(r.expense_date || r.doc_date || ""),
      category: String(r.category || "Expense"),
      amount: Number(r.amount || r.grand_total || 0),
      remarks: r.remarks == null ? null : String(r.remarks),
      salesman_id: r.salesman_id == null ? null : String(r.salesman_id),
      salesman_name: null,
      warehouse_name: null,
      vendor_name: null,
    }));

    const filteredExpenses = allExpenses.filter((e) => {
      if (q) {
        const text = `${e.expense_no || ""} ${e.category || ""} ${e.remarks || ""} ${e.amount || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const { paged, meta: pagMeta } = paginate(filteredExpenses, page, pageSize);

    body = (
      <ExpensesTable
        expenses={paged}
        pagination={pagMeta}
      />
    );
  } else if (
    kind === "cash_receipt" ||
    kind === "cash_payment" ||
    kind === "journal"
  ) {
    const allVouchers: VoucherRow[] = voucherFilteredRows.map((r) => ({
      id: String(r.id),
      voucher_no: String(r.voucher_no || r.doc_no || r.id),
      voucher_date: String(r.voucher_date || r.doc_date || ""),
      total_amount: Number(r.total_amount ?? r.amount ?? r.grand_total ?? 0),
      narration: r.narration == null ? null : String(r.narration),
    }));

    const filteredVouchers = allVouchers.filter((v) => {
      if (q) {
        const text = `${v.voucher_no || ""} ${v.narration || ""} ${v.total_amount || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const { paged, meta: pagMeta } = paginate(filteredVouchers, page, pageSize);

    const base =
      kind === "cash_receipt"
        ? "/vouchers/cash-receipt"
        : kind === "cash_payment"
          ? "/vouchers/cash-payment"
          : "/vouchers/journal";

    body = (
      <VouchersTable
        vouchers={paged}
        pagination={pagMeta}
        emptyLabel="No vouchers in local ledger yet."
        detailBasePath={base}
      />
    );
  } else if (kind === "recoveries") {
    const allRecoveries: RecoveryRow[] = voucherFilteredRows.map((r) => {
      const party = partyList.find((p) => p.id === r.party_id);
      const salesman = salesmen.find((s) => s.user_id === r.salesman_id);
      return {
        id: String(r.id),
        recovery_date: String(r.recovery_date || r.doc_date || r.voucher_date || ""),
        amount: Number(r.amount ?? r.total_amount ?? r.grand_total ?? 0),
        city: party?.city || null,
        route: party?.route || null,
        remarks: r.remarks == null && r.narration == null ? null : String(r.remarks || r.narration || ""),
        salesman_id: r.salesman_id ? String(r.salesman_id) : null,
        parties: party ? { party_code: party.party_code, name_en: party.name_en } : null,
        salesman: salesman ? { full_name: salesman.full_name } : null,
      };
    });

    const filteredRecoveries = allRecoveries.filter((rec) => {
      if (cityParam && rec.city !== cityParam) return false;
      if (sectorParam && rec.route !== sectorParam) return false;
      if (salesmanParam && rec.salesman?.full_name !== salesmanParam) return false;
      if (q) {
        const text = `${rec.parties?.party_code || ""} ${rec.parties?.name_en || ""} ${rec.city || ""} ${rec.route || ""} ${rec.salesman?.full_name || ""} ${rec.remarks || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const { paged, meta: pagMeta } = paginate(filteredRecoveries, page, pageSize);

    body = (
      <RecoveriesTable
        rows={paged}
        pagination={pagMeta}
        cityOptions={cityOptions}
        sectorOptions={sectorOptions}
        salesmanOptions={salesmen
          .filter((s) => s.full_name)
          .map((s) => ({ value: s.full_name!, label: s.full_name! }))}
      />
    );
  } else if (kind === "gate_passes") {
    const allGp: GatePassListRow[] = voucherFilteredRows.map((r) => ({
      id: String(r.id),
      pass_no: String(r.pass_no || r.doc_no || r.id),
      pass_date: String(r.pass_date || r.doc_date || ""),
      supplier: String(
        r.party_name ||
          partyList.find((p) => p.id === r.party_id)?.name_en ||
          "",
      ),
      warehouse: String(
        r.warehouse_name ||
          warehouseList.find((w) => w.id === r.warehouse_id)?.name ||
          "",
      ),
      brand: String(r.manufacturer || r.brand || ""),
      qty: String(r.qty || "—"),
    }));

    const filteredGp = allGp.filter((gp) => {
      if (q) {
        const text = `${gp.pass_no || ""} ${gp.supplier || ""} ${gp.warehouse || ""} ${gp.brand || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const { paged, meta: pagMeta } = paginate(filteredGp, page, pageSize);

    body = (
      <GatePassesTable
        rows={paged}
        pagination={pagMeta}
        warehouses={warehouseList}
      />
    );
  } else if (kind === "load_sheets") {
    const allLs: LoadSheetRow[] = voucherFilteredRows.map((r) => ({
      id: String(r.id),
      sheet_no: String(r.sheet_no || r.doc_no || r.id),
      sheet_date: String(r.sheet_date || r.doc_date || ""),
      warehouse: String(r.warehouse_name || ""),
      vehicle_route: String(r.vehicle_no || r.route || ""),
      qty: String(r.qty || "—"),
      status: String(r.status || "posted"),
    }));

    const filteredLs = allLs.filter((ls) => {
      if (q) {
        const text = `${ls.sheet_no || ""} ${ls.warehouse || ""} ${ls.vehicle_route || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const { paged, meta: pagMeta } = paginate(filteredLs, page, pageSize);

    body = (
      <LoadSheetsTable
        rows={paged}
        pagination={pagMeta}
        warehouses={warehouseList}
      />
    );
  } else if (kind === "stock_transfers") {
    const allTr: StockTransferRow[] = voucherFilteredRows.map((r) => ({
      id: String(r.id),
      transfer_no: String(r.transfer_no || r.doc_no || r.id),
      transfer_date: String(r.transfer_date || r.doc_date || ""),
      from_name: String(r.from_name || r.from_warehouse_name || ""),
      to_name: String(r.to_name || r.to_warehouse_name || ""),
    }));

    const filteredTr = allTr.filter((tr) => {
      if (q) {
        const text = `${tr.transfer_no || ""} ${tr.from_name || ""} ${tr.to_name || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const { paged, meta: pagMeta } = paginate(filteredTr, page, pageSize);

    body = (
      <TransfersTable
        rows={paged}
        pagination={pagMeta}
        warehouses={warehouseList}
      />
    );
  } else {
    // sale_returns, purchase_returns, expiry_receipts, expiry_claims
    const docRows: DocumentListRow[] = voucherFilteredRows.map((r) => ({
      id: String(r.id),
      docNo: String(r.invoice_no || r.doc_no || r._localId || r.id),
      date: String(
        r.invoice_date ||
          r.doc_date ||
          r.receipt_date ||
          r.claim_date ||
          "",
      ),
      partyLabel: String(
        (r.parties as { name_en?: string } | undefined)?.name_en ||
          partyList.find((p) => p.id === r.party_id)?.name_en ||
          r.party_name ||
          "",
      ),
      warehouseLabel: String(
        (r.warehouses as { name?: string } | undefined)?.name ||
          warehouseList.find((w) => w.id === r.warehouse_id)?.name ||
          "",
      ),
      paymentType: "",
      total: Number(r.grand_total ?? r.amount ?? 0) || 0,
      href:
        kind === "sale_returns"
          ? `/sales/returns/${r.id}`
          : kind === "purchase_returns"
            ? `/purchases/returns/${r.id}`
            : kind === "expiry_claims"
              ? `/inventory/expiry/claims/${r.id}`
              : `/inventory/expiry/receipts/${r.id}`,
      table: meta.store,
      linesTable: "",
      linesFk: "",
    }));

    const filteredDocs = docRows.filter((d) => {
      if (q) {
        const text = `${d.docNo || ""} ${d.partyLabel || ""} ${d.warehouseLabel || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const { paged, meta: pagMeta } = paginate(filteredDocs, page, pageSize);
    const totalAmount = filteredDocs.reduce((s, r) => s + (r.total || 0), 0);

    body = (
      <DocumentListTable
        title={dynamicMeta.title}
        rows={paged}
        pagination={pagMeta}
        summary={emptyDocumentSummary(totalAmount)}
        warehouses={warehouseList}
        showPrint
      />
    );
  }

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title={dynamicMeta.title}
        description={`${dynamicMeta.description} Company: ${companyName}.`}
        actions={
          <>
            {kind === "parties" && dynamicMeta.showLocations ? (
              <CreateDialogButton
                label="City / Head & Sector"
                title="City / head & sector"
                description="City and head are one list. Sector is the second list."
                size="lg"
              >
                <LocationListsManager
                  companyId={companyId}
                  organizationId={organizationId}
                  cityOptions={cityOptions}
                  sectorOptions={sectorOptions}
                />
              </CreateDialogButton>
            ) : null}
            <CreateDialogButton
              label={dynamicMeta.addLabel}
              title={dynamicMeta.addTitle}
              description={dynamicMeta.addDescription}
              size="xl"
            >
              {createForm}
            </CreateDialogButton>
          </>
        }
      />
      {body}
    </div>
  );
}
