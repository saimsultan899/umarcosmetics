-- Cancel RPCs for document tables that only have SELECT RLS.
-- Client hard-delete from DocumentRowActions fails without these.

-- ── Stock transfer ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tr public.stock_transfers%rowtype;
  v_item public.stock_transfer_items%rowtype;
BEGIN
  SELECT * INTO v_tr FROM public.stock_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock transfer not found'; END IF;
  IF NOT private.can_write_company(v_tr.company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;
  IF v_tr.status <> 'posted' THEN
    RAISE EXCEPTION 'This stock transfer is already cancelled';
  END IF;

  FOR v_item IN
    SELECT * FROM public.stock_transfer_items WHERE stock_transfer_id = v_tr.id
  LOOP
    -- Reverse: put stock back on from, remove from to.
    PERFORM private.apply_stock_delta(
      v_tr.company_id,
      v_tr.from_warehouse_id,
      v_item.product_id,
      abs(v_item.qty),
      'transfer_in',
      'stock_transfers',
      v_tr.id,
      true
    );
    PERFORM private.apply_stock_delta(
      v_tr.company_id,
      v_tr.to_warehouse_id,
      v_item.product_id,
      -abs(v_item.qty),
      'transfer_out',
      'stock_transfers',
      v_tr.id,
      true
    );
  END LOOP;

  UPDATE public.stock_transfers
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_tr.id;
END;
$function$;

-- ── Expiry receipt (customer return) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_expiry_receipt(p_receipt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_doc public.expiry_receipts%rowtype;
  v_item public.expiry_receipt_items%rowtype;
BEGIN
  SELECT * INTO v_doc FROM public.expiry_receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expiry receipt not found'; END IF;
  IF NOT private.can_write_company(v_doc.company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;
  IF v_doc.status <> 'posted' THEN
    RAISE EXCEPTION 'This expiry receipt is already cancelled';
  END IF;

  FOR v_item IN
    SELECT * FROM public.expiry_receipt_items WHERE receipt_id = v_doc.id
  LOOP
    IF coalesce(v_item.qty, 0) <> 0 THEN
      PERFORM private.apply_expiry_stock_delta(
        v_doc.company_id,
        v_item.product_id,
        -abs(v_item.qty),
        'adjustment',
        'expiry_receipts',
        v_doc.id,
        true
      );
    END IF;
  END LOOP;

  -- Original receipt credited the customer; reverse with a debit.
  PERFORM private.post_ledger(
    v_doc.organization_id,
    v_doc.company_id,
    v_doc.party_id,
    v_doc.receipt_date,
    v_doc.grand_total,
    0,
    'Cancel expiry return ' || v_doc.receipt_no,
    'expiry_receipts',
    v_doc.id,
    'EXR'
  );

  UPDATE public.expiry_receipts
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_doc.id;
END;
$function$;

-- ── Expiry claim (vendor) ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_expiry_claim(p_claim_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_doc public.expiry_claims%rowtype;
  v_item public.expiry_claim_items%rowtype;
BEGIN
  SELECT * INTO v_doc FROM public.expiry_claims WHERE id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expiry claim not found'; END IF;
  IF NOT private.can_write_company(v_doc.company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;
  IF v_doc.status <> 'posted' THEN
    RAISE EXCEPTION 'This expiry claim is already cancelled';
  END IF;
  IF coalesce(v_doc.claim_status, 'open') <> 'open' THEN
    RAISE EXCEPTION 'This claim is already settled and cannot be deleted';
  END IF;

  FOR v_item IN
    SELECT * FROM public.expiry_claim_items WHERE claim_id = v_doc.id
  LOOP
    IF coalesce(v_item.qty, 0) <> 0 THEN
      -- Claim removed expiry stock; put it back.
      PERFORM private.apply_expiry_stock_delta(
        v_doc.company_id,
        v_item.product_id,
        abs(v_item.qty),
        'adjustment',
        'expiry_claims',
        v_doc.id,
        true
      );
    END IF;
  END LOOP;

  -- Original claim debited the vendor; reverse with a credit.
  PERFORM private.post_ledger(
    v_doc.organization_id,
    v_doc.company_id,
    v_doc.party_id,
    v_doc.claim_date,
    0,
    v_doc.grand_total,
    'Cancel expiry claim ' || v_doc.claim_no,
    'expiry_claims',
    v_doc.id,
    'CLM'
  );

  UPDATE public.expiry_claims
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_doc.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_stock_transfer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_expiry_receipt(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_expiry_claim(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cancel_stock_transfer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_expiry_receipt(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_expiry_claim(uuid) TO authenticated, service_role;
