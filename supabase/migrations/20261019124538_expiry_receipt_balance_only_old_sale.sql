-- Old / manual customer sales: expiry return that only credits the shop balance
-- and does NOT add qty into expiry stock (so it cannot inflate company claim stock).
-- Normal receipts keep adding to expiry stock for the company claim flow.

ALTER TABLE public.expiry_receipts
  ADD COLUMN IF NOT EXISTS balance_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.expiry_receipts.balance_only IS
  'When true: credit customer ledger only (old/manual sale). Do not add to expiry stock.';

CREATE OR REPLACE FUNCTION public.create_expiry_receipt(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_id uuid;
  v_no text;
  v_item jsonb;
  v_idx int := 0;
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'receipt_date')::date, current_date);
  v_party uuid := (p_payload->>'party_id')::uuid;
  v_qty numeric;
  v_balance_only boolean := coalesce((p_payload->>'balance_only')::boolean, false);
  v_narration text;
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;
  IF v_party IS NULL THEN
    RAISE EXCEPTION 'Select a customer';
  END IF;
  IF v_balance_only AND v_total <= 0.005 THEN
    RAISE EXCEPTION 'Balance-only expiry return needs a recover amount greater than zero';
  END IF;

  v_no := public.next_document_no(v_company_id, 'expiry_receipt', 'EXR-');

  INSERT INTO public.expiry_receipts (
    organization_id, company_id, receipt_no, receipt_date, party_id,
    period_from, period_to, subtotal, grand_total, narration, status, created_by,
    balance_only
  ) VALUES (
    v_org_id, v_company_id, v_no, v_date, v_party,
    nullif(p_payload->>'period_from','')::date,
    nullif(p_payload->>'period_to','')::date,
    coalesce((p_payload->>'subtotal')::numeric, 0),
    v_total,
    nullif(p_payload->>'narration',''),
    'posted', auth.uid(),
    v_balance_only
  ) RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  LOOP
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    INSERT INTO public.expiry_receipt_items (
      receipt_id, company_id, product_id, product_code, product_name,
      history_qty, history_amount, qty, rate, amount, sort_order
    ) VALUES (
      v_id, v_company_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_code',
      v_item->>'product_name',
      coalesce((v_item->>'history_qty')::numeric, 0),
      coalesce((v_item->>'history_amount')::numeric, 0),
      v_qty,
      coalesce((v_item->>'rate')::numeric, 0),
      coalesce((v_item->>'amount')::numeric, 0),
      v_idx
    );
    -- Normal path: qty goes into expiry stock for later company claim.
    -- Balance-only (old/manual sale): credit shop only — no expiry stock.
    IF NOT v_balance_only AND v_qty > 0 THEN
      PERFORM private.apply_expiry_stock_delta(
        v_company_id, (v_item->>'product_id')::uuid, v_qty,
        'receipt', 'expiry_receipts', v_id, true
      );
    END IF;
    v_idx := v_idx + 1;
  END LOOP;

  IF v_idx = 0 THEN
    RAISE EXCEPTION 'Add at least one expired item';
  END IF;

  IF v_balance_only THEN
    v_narration := format(
      'Expiry return (balance only — old/manual sale, no expiry stock) %s · credit %s',
      v_no,
      trim(to_char(v_total, '9999999999990.99'))
    );
  ELSE
    v_narration := 'Expiry return ' || v_no;
  END IF;

  IF nullif(trim(coalesce(p_payload->>'narration','')), '') IS NOT NULL THEN
    v_narration := v_narration || ' — ' || trim(p_payload->>'narration');
  END IF;

  PERFORM private.post_ledger(
    v_org_id, v_company_id, v_party, v_date, 0, v_total,
    v_narration, 'expiry_receipts', v_id, 'EXR'
  );
  RETURN v_id;
END;
$function$;

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
          'adjustment',
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

GRANT EXECUTE ON FUNCTION public.create_expiry_receipt(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_expiry_receipt(uuid) TO authenticated, service_role;
