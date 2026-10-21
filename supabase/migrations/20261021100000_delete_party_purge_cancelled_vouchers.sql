-- Hard-delete customers even when only cancelled recoveries/vouchers (or other
-- cancelled docs) still hold FK rows. Posted documents still block delete.

CREATE OR REPLACE FUNCTION private.purge_cancelled_vouchers_for_party(p_party_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT DISTINCT v.id
    FROM public.vouchers v
    JOIN public.voucher_lines vl ON vl.voucher_id = v.id
    WHERE v.status = 'cancelled'
      AND (
        vl.party_id = p_party_id
        OR vl.debit_party_id = p_party_id
        OR vl.credit_party_id = p_party_id
      )
  LOOP
    DELETE FROM public.ledger_entries
    WHERE ref_table = 'vouchers' AND ref_id = v_id;

    DELETE FROM public.voucher_lines
    WHERE voucher_id = v_id
      AND (
        party_id = p_party_id
        OR debit_party_id = p_party_id
        OR credit_party_id = p_party_id
      );

    IF NOT EXISTS (
      SELECT 1 FROM public.voucher_lines WHERE voucher_id = v_id
    ) THEN
      DELETE FROM public.vouchers WHERE id = v_id AND status = 'cancelled';
    END IF;
  END LOOP;
END;
$$;

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
  gp record;
  er record;
  ec record;
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
    UNION ALL
    SELECT DISTINCT 'expense'
    FROM public.expenses
    WHERE party_id = p_party_id OR vendor_id = p_party_id
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

  -- Cancelled recoveries/receipts leave voucher_lines that blocked party delete (FK 23503).
  PERFORM private.purge_cancelled_vouchers_for_party(p_party_id);

  FOR gp IN
    SELECT id FROM public.gate_passes
    WHERE party_id = p_party_id AND status = 'cancelled'
  LOOP
    DELETE FROM public.ledger_entries
    WHERE ref_table = 'gate_passes' AND ref_id = gp.id;
    DELETE FROM public.stock_movements
    WHERE ref_table = 'gate_passes' AND ref_id = gp.id;
    DELETE FROM public.gate_pass_items WHERE gate_pass_id = gp.id;
    DELETE FROM public.gate_passes WHERE id = gp.id AND status = 'cancelled';
  END LOOP;

  FOR er IN
    SELECT id FROM public.expiry_receipts
    WHERE party_id = p_party_id AND status = 'cancelled'
  LOOP
    DELETE FROM public.ledger_entries
    WHERE ref_table = 'expiry_receipts' AND ref_id = er.id;
    DELETE FROM public.expiry_stock_movements
    WHERE ref_table = 'expiry_receipts' AND ref_id = er.id;
    DELETE FROM public.expiry_receipt_items WHERE receipt_id = er.id;
    DELETE FROM public.expiry_receipts WHERE id = er.id AND status = 'cancelled';
  END LOOP;

  FOR ec IN
    SELECT id FROM public.expiry_claims
    WHERE party_id = p_party_id AND status = 'cancelled'
  LOOP
    DELETE FROM public.ledger_entries
    WHERE ref_table = 'expiry_claims' AND ref_id = ec.id;
    DELETE FROM public.expiry_stock_movements
    WHERE ref_table = 'expiry_claims' AND ref_id = ec.id;
    DELETE FROM public.expiry_claim_items WHERE claim_id = ec.id;
    DELETE FROM public.expiry_claims WHERE id = ec.id AND status = 'cancelled';
  END LOOP;

  DELETE FROM public.ledger_entries WHERE party_id = p_party_id;

  DELETE FROM public.parties WHERE id = p_party_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_party(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_party(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.purge_cancelled_vouchers_for_party(uuid) FROM PUBLIC;
