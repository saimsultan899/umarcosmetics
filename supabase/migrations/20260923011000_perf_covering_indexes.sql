-- Performance: add covering indexes for foreign keys that are hit by RLS
-- predicates (company_id / organization_id), party ledgers (party_id), and
-- document line lookups (parent doc id). Resolves the highest-impact entries
-- from the `unindexed_foreign_keys` advisor. Bulk-insert / created_by-style
-- FKs that are never filtered are intentionally skipped to keep writes fast.

-- company_id on detail / line tables (RLS filters every read by company) ------
CREATE INDEX IF NOT EXISTS expiry_claim_items_company_idx
  ON public.expiry_claim_items (company_id);
CREATE INDEX IF NOT EXISTS expiry_receipt_items_company_idx
  ON public.expiry_receipt_items (company_id);
CREATE INDEX IF NOT EXISTS expiry_settlement_items_company_idx
  ON public.expiry_settlement_items (company_id);
CREATE INDEX IF NOT EXISTS expiry_stock_movements_company_idx
  ON public.expiry_stock_movements (company_id);
CREATE INDEX IF NOT EXISTS gate_pass_items_company_idx
  ON public.gate_pass_items (company_id);
CREATE INDEX IF NOT EXISTS load_sheet_items_company_idx
  ON public.load_sheet_items (company_id);
CREATE INDEX IF NOT EXISTS purchase_invoice_items_company_idx
  ON public.purchase_invoice_items (company_id);
CREATE INDEX IF NOT EXISTS purchase_return_items_company_idx
  ON public.purchase_return_items (company_id);
CREATE INDEX IF NOT EXISTS sale_invoice_items_company_idx
  ON public.sale_invoice_items (company_id);
CREATE INDEX IF NOT EXISTS sale_return_items_company_idx
  ON public.sale_return_items (company_id);
CREATE INDEX IF NOT EXISTS stock_transfer_items_company_idx
  ON public.stock_transfer_items (company_id);
CREATE INDEX IF NOT EXISTS voucher_lines_company_idx
  ON public.voucher_lines (company_id);

-- parent document id on line tables (loading a document's lines) -------------
CREATE INDEX IF NOT EXISTS purchase_invoice_items_invoice_idx
  ON public.purchase_invoice_items (purchase_invoice_id);
CREATE INDEX IF NOT EXISTS purchase_return_items_return_idx
  ON public.purchase_return_items (purchase_return_id);
CREATE INDEX IF NOT EXISTS sale_return_items_return_idx
  ON public.sale_return_items (sale_return_id);
CREATE INDEX IF NOT EXISTS load_sheet_items_sheet_idx
  ON public.load_sheet_items (load_sheet_id);
CREATE INDEX IF NOT EXISTS stock_transfer_items_transfer_idx
  ON public.stock_transfer_items (stock_transfer_id);
CREATE INDEX IF NOT EXISTS expiry_settlement_items_settlement_idx
  ON public.expiry_settlement_items (settlement_id);

-- party_id on transaction / ledger tables (party statements & aging) ---------
CREATE INDEX IF NOT EXISTS ledger_entries_party_idx
  ON public.ledger_entries (party_id);
CREATE INDEX IF NOT EXISTS sale_invoices_party_idx
  ON public.sale_invoices (party_id);
CREATE INDEX IF NOT EXISTS purchase_invoices_party_idx
  ON public.purchase_invoices (party_id);
CREATE INDEX IF NOT EXISTS sale_returns_party_idx
  ON public.sale_returns (party_id);
CREATE INDEX IF NOT EXISTS purchase_returns_party_idx
  ON public.purchase_returns (party_id);
CREATE INDEX IF NOT EXISTS gate_passes_party_idx
  ON public.gate_passes (party_id);
CREATE INDEX IF NOT EXISTS expiry_claims_party_idx
  ON public.expiry_claims (party_id);
CREATE INDEX IF NOT EXISTS expiry_receipts_party_idx
  ON public.expiry_receipts (party_id);
CREATE INDEX IF NOT EXISTS recoveries_party_idx
  ON public.recoveries (party_id);

-- salesman_id on transaction tables (salesman ledger / recovery) -------------
CREATE INDEX IF NOT EXISTS sale_invoices_salesman_idx
  ON public.sale_invoices (salesman_id);
CREATE INDEX IF NOT EXISTS recoveries_salesman_idx
  ON public.recoveries (salesman_id);
CREATE INDEX IF NOT EXISTS load_sheets_salesman_idx
  ON public.load_sheets (salesman_id);
