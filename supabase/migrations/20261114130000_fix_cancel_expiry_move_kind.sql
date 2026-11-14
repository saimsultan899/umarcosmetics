-- Cancelled expiry returns/claims wrote move_kind = 'adjustment'.
-- expiry_stock_movements only allows receipt | claim | reject | adjust.

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

  -- Only reverse expiry stock when this receipt actually added stock.
  IF NOT coalesce(v_doc.balance_only, false) THEN
    FOR v_item IN
      SELECT * FROM public.expiry_receipt_items WHERE receipt_id = v_doc.id
    LOOP
      IF coalesce(v_item.qty, 0) <> 0 THEN
        PERFORM private.apply_expiry_stock_delta(
          v_doc.company_id,
          v_item.product_id,
          -abs(v_item.qty),
          'adjust',
          'expiry_receipts',
          v_doc.id,
          true
        );
      END IF;
    END LOOP;
  END IF;

  PERFORM private.post_ledger(
    v_doc.organization_id,
    v_doc.company_id,
    v_doc.party_id,
    v_doc.receipt_date,
    v_doc.grand_total,
    0,
    CASE
      WHEN coalesce(v_doc.balance_only, false) THEN
        'Cancel expiry return (balance only) ' || v_doc.receipt_no
      ELSE
        'Cancel expiry return ' || v_doc.receipt_no
    END,
    'expiry_receipts',
    v_doc.id,
    'EXR'
  );

  UPDATE public.expiry_receipts
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_doc.id;
END;
$function$;

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
      PERFORM private.apply_expiry_stock_delta(
        v_doc.company_id,
        v_item.product_id,
        abs(v_item.qty),
        'adjust',
        'expiry_claims',
        v_doc.id,
        true
      );
    END IF;
  END LOOP;

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

GRANT EXECUTE ON FUNCTION public.cancel_expiry_receipt(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_expiry_claim(uuid) TO authenticated, service_role;
