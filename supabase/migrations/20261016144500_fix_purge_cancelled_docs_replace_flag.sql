-- Product/party delete clears cancelled bill lines/headers. The delete guard
-- treated that like deleting posted docs. Set the replace flag, and allow
-- cancelled header removal only while that flag is on.

CREATE OR REPLACE FUNCTION private.guard_record_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_key text;
  v_company_id uuid;
  v_status_changed boolean;
  v_fields_changed boolean;
BEGIN
  IF auth.uid() IS NULL OR private.is_super_admin() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'recoveries'
       AND current_setting('app.cancelling_recovery', true) = '1' THEN
      RETURN OLD;
    END IF;

    IF current_setting('app.replacing_document_lines', true) = '1'
       AND TG_TABLE_NAME IN (
         'sale_invoice_items',
         'purchase_invoice_items',
         'sale_return_items',
         'purchase_return_items',
         'voucher_lines'
       ) THEN
      RETURN OLD;
    END IF;

    -- Product/party cleanup may remove cancelled headers after lines are cleared.
    IF current_setting('app.replacing_document_lines', true) = '1'
       AND TG_TABLE_NAME IN (
         'sale_invoices',
         'purchase_invoices',
         'sale_returns',
         'purchase_returns',
         'vouchers'
       )
       AND OLD.status = 'cancelled' THEN
      RETURN OLD;
    END IF;

    v_company_id := OLD.company_id;
    IF TG_TABLE_NAME IN ('products', 'parties') THEN
      IF EXISTS (
        SELECT 1
        FROM public.company_members cm
        WHERE cm.user_id = auth.uid()
          AND cm.company_id = v_company_id
          AND cm.is_active
          AND cm.role = 'org_admin'
      ) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'Only the organization admin can delete products and customers.'
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Posted sales, purchases, vouchers, and returns cannot be deleted. Correct them with a return or a reversal.'
      USING ERRCODE = '42501';
  END IF;

  v_company_id := NEW.company_id;

  IF TG_OP = 'INSERT' THEN
    v_key := CASE TG_TABLE_NAME
      WHEN 'products' THEN 'edit_products'
      WHEN 'parties' THEN 'edit_customers'
      WHEN 'sale_invoices' THEN 'create_invoices'
      WHEN 'sale_returns' THEN 'create_invoices'
      WHEN 'purchase_invoices' THEN 'create_purchases'
      WHEN 'purchase_returns' THEN 'create_purchases'
      WHEN 'vouchers' THEN 'create_vouchers'
      ELSE NULL
    END;
    IF v_key IS NOT NULL AND NOT private.has_permission(v_company_id, v_key) THEN
      RAISE EXCEPTION 'You do not have permission for this action.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME IN ('products', 'parties') AND TG_OP = 'UPDATE' THEN
    v_status_changed := OLD.is_active IS DISTINCT FROM NEW.is_active;
    v_fields_changed := (to_jsonb(NEW) - 'is_active' - 'updated_at')
      IS DISTINCT FROM (to_jsonb(OLD) - 'is_active' - 'updated_at');
    IF v_status_changed
       AND NOT private.has_permission(v_company_id, 'inactivate_records') THEN
      RAISE EXCEPTION 'You do not have permission to inactivate records.'
        USING ERRCODE = '42501';
    END IF;
    IF v_fields_changed AND NOT private.has_permission(
      v_company_id,
      CASE
        WHEN TG_TABLE_NAME = 'products' THEN 'edit_products'
        ELSE 'edit_customers'
      END
    ) THEN
      RAISE EXCEPTION 'You do not have permission to edit this record.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.purge_cancelled_sale_invoice(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sale_invoices
    WHERE id = p_invoice_id AND status = 'cancelled'
  ) THEN
    RETURN;
  END IF;

  PERFORM set_config('app.replacing_document_lines', '1', true);

  DELETE FROM public.ledger_entries
  WHERE ref_table = 'sale_invoices' AND ref_id = p_invoice_id;

  DELETE FROM public.stock_movements
  WHERE ref_table = 'sale_invoices' AND ref_id = p_invoice_id;

  DELETE FROM public.sale_invoice_items
  WHERE sale_invoice_id = p_invoice_id;

  DELETE FROM public.sale_invoices
  WHERE id = p_invoice_id AND status = 'cancelled';
END;
$$;

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
    SELECT DISTINCT 'expiry claim ' || c.claim_no
    FROM public.expiry_claim_items i
    JOIN public.expiry_claims c ON c.id = i.claim_id
    WHERE i.product_id = p_product_id AND c.status = 'posted'
    UNION ALL
    SELECT DISTINCT 'expiry settlement ' || s.settlement_no
    FROM public.expiry_settlement_items i
    JOIN public.expiry_settlements s ON s.id = i.settlement_id
    WHERE i.product_id = p_product_id
    UNION ALL
    SELECT DISTINCT 'gate pass ' || g.pass_no
    FROM public.gate_pass_items i
    JOIN public.gate_passes g ON g.id = i.gate_pass_id
    WHERE i.product_id = p_product_id AND g.status = 'posted'
    UNION ALL
    SELECT DISTINCT 'load sheet ' || l.sheet_no
    FROM public.load_sheet_items i
    JOIN public.load_sheets l ON l.id = i.load_sheet_id
    WHERE i.product_id = p_product_id AND l.status = 'posted'
    UNION ALL
    SELECT DISTINCT 'stock transfer ' || t.transfer_no
    FROM public.stock_transfer_items i
    JOIN public.stock_transfers t ON t.id = i.stock_transfer_id
    WHERE i.product_id = p_product_id AND t.status = 'posted'
  ) x;

  IF coalesce(v_blockers, '') <> '' THEN
    RAISE EXCEPTION
      'Product % — % is still used on posted documents (%). Cancel those bills first, then delete the product — or mark it inactive.',
      v_code, v_name, v_blockers;
  END IF;

  PERFORM set_config('app.replacing_document_lines', '1', true);

  -- Remove lines only from cancelled trading docs.
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

  DELETE FROM public.expiry_claim_items i
  USING public.expiry_claims c
  WHERE i.claim_id = c.id
    AND i.product_id = p_product_id
    AND c.status = 'cancelled';

  DELETE FROM public.gate_pass_items i
  USING public.gate_passes g
  WHERE i.gate_pass_id = g.id
    AND i.product_id = p_product_id
    AND g.status = 'cancelled';

  DELETE FROM public.load_sheet_items i
  USING public.load_sheets l
  WHERE i.load_sheet_id = l.id
    AND i.product_id = p_product_id
    AND l.status = 'cancelled';

  DELETE FROM public.stock_transfer_items i
  USING public.stock_transfers t
  WHERE i.stock_transfer_id = t.id
    AND i.product_id = p_product_id
    AND t.status = 'cancelled';

  DELETE FROM public.product_rate_slabs WHERE product_id = p_product_id;

  DELETE FROM public.stock_movements WHERE product_id = p_product_id;
  DELETE FROM public.stock_balances WHERE product_id = p_product_id;
  DELETE FROM public.expiry_stock_movements WHERE product_id = p_product_id;
  DELETE FROM public.expiry_stock_balances WHERE product_id = p_product_id;

  DELETE FROM public.products WHERE id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_product(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_party(p_party_id uuid)
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
  inv record;
BEGIN
  SELECT company_id, party_code, name_en
    INTO v_company_id, v_code, v_name
  FROM public.parties
  WHERE id = p_party_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Party not found';
  END IF;

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
      RAISE EXCEPTION 'Only the organization admin can delete customers.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT string_agg(label, ', ' ORDER BY label)
    INTO v_blockers
  FROM (
    SELECT DISTINCT 'sale ' || invoice_no AS label
    FROM public.sale_invoices
    WHERE party_id = p_party_id AND status = 'posted'
    UNION ALL
    SELECT DISTINCT 'sale return ' || return_no
    FROM public.sale_returns
    WHERE party_id = p_party_id AND status = 'posted'
    UNION ALL
    SELECT DISTINCT 'purchase ' || invoice_no
    FROM public.purchase_invoices
    WHERE party_id = p_party_id AND status = 'posted'
    UNION ALL
    SELECT DISTINCT 'purchase return ' || return_no
    FROM public.purchase_returns
    WHERE party_id = p_party_id AND status = 'posted'
    UNION ALL
    SELECT DISTINCT 'recovery'
    FROM public.recoveries
    WHERE party_id = p_party_id
    UNION ALL
    SELECT DISTINCT 'voucher ' || coalesce(v.voucher_no, v.id::text)
    FROM public.voucher_lines vl
    JOIN public.vouchers v ON v.id = vl.voucher_id
    WHERE (vl.party_id = p_party_id OR vl.debit_party_id = p_party_id OR vl.credit_party_id = p_party_id)
      AND coalesce(v.status, 'posted') = 'posted'
    UNION ALL
    SELECT DISTINCT 'gate pass ' || pass_no
    FROM public.gate_passes
    WHERE party_id = p_party_id AND status = 'posted'
    UNION ALL
    SELECT DISTINCT 'expiry receipt ' || receipt_no
    FROM public.expiry_receipts
    WHERE party_id = p_party_id AND status = 'posted'
    UNION ALL
    SELECT DISTINCT 'expiry claim ' || claim_no
    FROM public.expiry_claims
    WHERE party_id = p_party_id AND status = 'posted'
  ) x;

  IF coalesce(v_blockers, '') <> '' THEN
    RAISE EXCEPTION
      'Customer % — % is still on posted documents (%). Cancel those first, then delete — or mark inactive.',
      v_code, v_name, v_blockers;
  END IF;

  PERFORM set_config('app.replacing_document_lines', '1', true);

  -- Purge cancelled sales for this party so the header FK no longer blocks.
  FOR inv IN
    SELECT id FROM public.sale_invoices
    WHERE party_id = p_party_id AND status = 'cancelled'
  LOOP
    PERFORM private.purge_cancelled_sale_invoice(inv.id);
  END LOOP;

  DELETE FROM public.sale_return_items i
  USING public.sale_returns sr
  WHERE i.sale_return_id = sr.id AND sr.party_id = p_party_id AND sr.status = 'cancelled';
  DELETE FROM public.ledger_entries le
  USING public.sale_returns sr
  WHERE le.ref_table = 'sale_returns' AND le.ref_id = sr.id AND sr.party_id = p_party_id AND sr.status = 'cancelled';
  DELETE FROM public.sale_returns WHERE party_id = p_party_id AND status = 'cancelled';

  DELETE FROM public.purchase_invoice_items i
  USING public.purchase_invoices pi
  WHERE i.purchase_invoice_id = pi.id AND pi.party_id = p_party_id AND pi.status = 'cancelled';
  DELETE FROM public.ledger_entries le
  USING public.purchase_invoices pi
  WHERE le.ref_table = 'purchase_invoices' AND le.ref_id = pi.id AND pi.party_id = p_party_id AND pi.status = 'cancelled';
  DELETE FROM public.purchase_invoices WHERE party_id = p_party_id AND status = 'cancelled';

  DELETE FROM public.purchase_return_items i
  USING public.purchase_returns pr
  WHERE i.purchase_return_id = pr.id AND pr.party_id = p_party_id AND pr.status = 'cancelled';
  DELETE FROM public.purchase_returns WHERE party_id = p_party_id AND status = 'cancelled';

  DELETE FROM public.ledger_entries WHERE party_id = p_party_id;

  DELETE FROM public.parties WHERE id = p_party_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_party(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_party(uuid) TO authenticated, service_role;
