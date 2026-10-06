-- Hard-delete products that are not on any POSTED document.
-- Cancelled invoices keep history, so a plain DELETE fails on FKs even after
-- "delete" (cancel). This RPC cleans cancelled-only links + stock history,
-- then removes the product. Posted usage still blocks delete.

CREATE OR REPLACE FUNCTION public.delete_product(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id uuid;
  v_code text;
  v_name text;
  v_blockers text;
BEGIN
  SELECT company_id, code, name_en
    INTO v_company_id, v_code, v_name
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  -- service_role / SQL console may have no auth.uid(); org_admin required for app users.
  IF auth.uid() IS NOT NULL THEN
    IF NOT private.can_write_company(v_company_id) THEN
      RAISE EXCEPTION 'No write access';
    END IF;
    IF NOT private.is_super_admin()
       AND NOT EXISTS (
         SELECT 1
         FROM public.company_members cm
         WHERE cm.user_id = auth.uid()
           AND cm.company_id = v_company_id
           AND cm.is_active
           AND cm.role = 'org_admin'
       )
    THEN
      RAISE EXCEPTION 'Only the organization admin can delete products.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Collect posted-document blockers (cancel is not enough to free the product).
  SELECT string_agg(label, ', ' ORDER BY label)
    INTO v_blockers
  FROM (
    SELECT DISTINCT 'sale ' || si.invoice_no AS label
    FROM public.sale_invoice_items i
    JOIN public.sale_invoices si ON si.id = i.sale_invoice_id
    WHERE i.product_id = p_product_id AND si.status = 'posted'
    UNION ALL
    SELECT DISTINCT 'sale return ' || r.return_no
    FROM public.sale_return_items i
    JOIN public.sale_returns r ON r.id = i.sale_return_id
    WHERE i.product_id = p_product_id AND r.status = 'posted'
    UNION ALL
    SELECT DISTINCT 'purchase ' || pi.invoice_no
    FROM public.purchase_invoice_items i
    JOIN public.purchase_invoices pi ON pi.id = i.purchase_invoice_id
    WHERE i.product_id = p_product_id AND pi.status = 'posted'
    UNION ALL
    SELECT DISTINCT 'purchase return ' || r.return_no
    FROM public.purchase_return_items i
    JOIN public.purchase_returns r ON r.id = i.purchase_return_id
    WHERE i.product_id = p_product_id AND r.status = 'posted'
    UNION ALL
    SELECT DISTINCT 'expiry receipt ' || e.receipt_no
    FROM public.expiry_receipt_items i
    JOIN public.expiry_receipts e ON e.id = i.receipt_id
    WHERE i.product_id = p_product_id AND e.status = 'posted'
    UNION ALL
    SELECT DISTINCT 'gate pass ' || g.pass_no
    FROM public.gate_pass_items i
    JOIN public.gate_passes g ON g.id = i.gate_pass_id
    WHERE i.product_id = p_product_id
    UNION ALL
    SELECT DISTINCT 'load sheet ' || l.sheet_no
    FROM public.load_sheet_items i
    JOIN public.load_sheets l ON l.id = i.load_sheet_id
    WHERE i.product_id = p_product_id
    UNION ALL
    SELECT DISTINCT 'stock transfer ' || t.transfer_no
    FROM public.stock_transfer_items i
    JOIN public.stock_transfers t ON t.id = i.stock_transfer_id
    WHERE i.product_id = p_product_id
  ) x;

  IF coalesce(v_blockers, '') <> '' THEN
    RAISE EXCEPTION
      'Product % — % is still used on posted documents (%). Cancel is not enough; mark the product inactive instead.',
      v_code, v_name, v_blockers;
  END IF;

  -- Remove lines only from cancelled trading docs (history names stay on the header totals).
  DELETE FROM public.sale_invoice_items i
  USING public.sale_invoices si
  WHERE i.sale_invoice_id = si.id
    AND i.product_id = p_product_id
    AND si.status = 'cancelled';

  DELETE FROM public.sale_return_items i
  USING public.sale_returns r
  WHERE i.sale_return_id = r.id
    AND i.product_id = p_product_id
    AND r.status = 'cancelled';

  DELETE FROM public.purchase_invoice_items i
  USING public.purchase_invoices pi
  WHERE i.purchase_invoice_id = pi.id
    AND i.product_id = p_product_id
    AND pi.status = 'cancelled';

  DELETE FROM public.purchase_return_items i
  USING public.purchase_returns r
  WHERE i.purchase_return_id = r.id
    AND i.product_id = p_product_id
    AND r.status = 'cancelled';

  DELETE FROM public.expiry_receipt_items i
  USING public.expiry_receipts e
  WHERE i.receipt_id = e.id
    AND i.product_id = p_product_id
    AND e.status = 'cancelled';

  -- Stock ledger rows block FK delete; safe once no posted usage remains.
  DELETE FROM public.stock_movements WHERE product_id = p_product_id;
  DELETE FROM public.stock_balances WHERE product_id = p_product_id;
  DELETE FROM public.expiry_stock_movements WHERE product_id = p_product_id;
  DELETE FROM public.expiry_stock_balances WHERE product_id = p_product_id;

  DELETE FROM public.products WHERE id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_product(uuid) TO authenticated, service_role;
