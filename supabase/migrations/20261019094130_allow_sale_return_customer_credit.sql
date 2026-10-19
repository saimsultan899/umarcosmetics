-- Allow sale returns even when the customer balance is nil or less than the
-- return amount. Extra return becomes customer credit (negative receivable),
-- which get_party_balance / ledger / receivables already show as Cr and apply
-- against future sales as previous balance.

CREATE OR REPLACE FUNCTION public.create_sale_return(p_payload jsonb)
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
  v_extra numeric := greatest(0, coalesce((p_payload->>'extra_discount')::numeric, 0));
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'return_date')::date, current_date);
  v_party uuid := (p_payload->>'party_id')::uuid;
  v_invoice uuid := nullif(p_payload->>'sale_invoice_id', '')::uuid;
  v_product uuid;
  v_qty numeric;
  v_bonus numeric;
  v_sold_qty numeric;
  v_sold_bonus numeric;
  v_ret_qty numeric;
  v_ret_bonus numeric;
  v_name text;
BEGIN
  IF NOT private.can_write_company(v_company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;

  IF v_invoice IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.sale_invoices s
      WHERE s.id = v_invoice
        AND s.company_id = v_company_id
        AND s.party_id = v_party
        AND s.status = 'posted'
    ) THEN
      RAISE EXCEPTION 'Sale return must use the same customer as the posted invoice';
    END IF;
  END IF;

  v_no := public.next_document_no(v_company_id, 'sale_return', null);
  INSERT INTO public.sale_returns (
    organization_id, company_id, return_no, return_date, party_id, warehouse_id,
    sale_invoice_id, subtotal, discount_total, extra_discount, grand_total, narration, status, created_by
  ) VALUES (
    v_org_id, v_company_id, v_no, v_date, v_party,
    (p_payload->>'warehouse_id')::uuid,
    v_invoice,
    coalesce((p_payload->>'subtotal')::numeric, 0),
    coalesce((p_payload->>'discount_total')::numeric, 0),
    v_extra,
    v_total, nullif(p_payload->>'narration', ''), 'posted', auth.uid()
  ) RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  LOOP
    v_product := (v_item->>'product_id')::uuid;
    v_qty := abs(coalesce((v_item->>'qty')::numeric, 0));
    v_bonus := greatest(0, coalesce((v_item->>'bonus_qty')::numeric, 0));
    v_name := coalesce(nullif(v_item->>'product_name', ''), nullif(v_item->>'product_code', ''), 'item');

    IF v_invoice IS NOT NULL THEN
      SELECT coalesce(sum(i.qty), 0), coalesce(sum(i.bonus_qty), 0)
        INTO v_sold_qty, v_sold_bonus
      FROM public.sale_invoice_items i
      WHERE i.sale_invoice_id = v_invoice
        AND i.product_id = v_product;

      SELECT coalesce(sum(ri.qty), 0), coalesce(sum(ri.bonus_qty), 0)
        INTO v_ret_qty, v_ret_bonus
      FROM public.sale_return_items ri
      JOIN public.sale_returns r ON r.id = ri.sale_return_id
      WHERE r.sale_invoice_id = v_invoice
        AND r.status = 'posted'
        AND ri.product_id = v_product;

      IF v_sold_qty = 0 AND v_sold_bonus = 0 THEN
        RAISE EXCEPTION 'Product % is not on that sale invoice', v_name;
      END IF;
      IF v_ret_qty + v_qty > v_sold_qty + 0.0005 THEN
        RAISE EXCEPTION 'Return qty for % is more than that invoice still has', v_name;
      END IF;
      IF v_ret_bonus + v_bonus > v_sold_bonus + 0.0005 THEN
        RAISE EXCEPTION 'Return free qty for % is more than that invoice still has', v_name;
      END IF;
    END IF;

    INSERT INTO public.sale_return_items (
      sale_return_id, company_id, product_id, product_code, product_name,
      qty, bonus_qty, rate, discount, amount, sort_order
    ) VALUES (
      v_id, v_company_id, v_product, v_item->>'product_code', v_item->>'product_name',
      v_qty, v_bonus, coalesce((v_item->>'rate')::numeric, 0),
      coalesce((v_item->>'discount')::numeric, 0),
      coalesce((v_item->>'amount')::numeric, 0), v_idx
    );

    PERFORM private.apply_stock_delta(
      v_company_id, (p_payload->>'warehouse_id')::uuid, v_product,
      v_qty + v_bonus, 'sale_return', 'sale_returns', v_id, true
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- Credit the customer (reduces due / creates Cr when due was nil).
  PERFORM private.post_ledger(
    v_org_id, v_company_id, v_party, v_date, 0, v_total,
    'Sale return ' || v_no, 'sale_returns', v_id, 'SR'
  );
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_sale_return(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := (p_payload->>'return_id')::uuid;
  v_ret public.sale_returns%rowtype;
  v_old public.sale_return_items%rowtype;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_org_id uuid := (p_payload->>'organization_id')::uuid;
  v_party uuid := (p_payload->>'party_id')::uuid;
  v_wh uuid := (p_payload->>'warehouse_id')::uuid;
  v_invoice uuid := nullif(p_payload->>'sale_invoice_id', '')::uuid;
  v_extra numeric := greatest(0, coalesce((p_payload->>'extra_discount')::numeric, 0));
  v_total numeric := coalesce((p_payload->>'grand_total')::numeric, 0);
  v_date date := coalesce((p_payload->>'return_date')::date, current_date);
  v_item jsonb;
  v_idx int := 0;
  v_product uuid;
  v_qty numeric;
  v_bonus numeric;
  v_sold_qty numeric;
  v_sold_bonus numeric;
  v_ret_qty numeric;
  v_ret_bonus numeric;
  v_name text;
BEGIN
  PERFORM set_config('app.replacing_document_lines', '1', true);
  SELECT * INTO v_ret FROM public.sale_returns WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Return not found'; END IF;
  IF NOT private.can_write_company(v_ret.company_id) THEN RAISE EXCEPTION 'No write access'; END IF;
  IF v_ret.status <> 'posted' THEN RAISE EXCEPTION 'This return is already cancelled'; END IF;
  IF v_company_id IS DISTINCT FROM v_ret.company_id THEN RAISE EXCEPTION 'Company does not match this return'; END IF;

  FOR v_old IN SELECT * FROM public.sale_return_items WHERE sale_return_id = v_ret.id
  LOOP
    PERFORM private.apply_stock_delta(
      v_ret.company_id, v_ret.warehouse_id, v_old.product_id,
      -(abs(v_old.qty) + coalesce(v_old.bonus_qty, 0)),
      'adjustment', 'sale_returns', v_ret.id, true
    );
  END LOOP;

  DELETE FROM public.ledger_entries
  WHERE ref_table = 'sale_returns' AND ref_id = v_ret.id;
  DELETE FROM public.sale_return_items WHERE sale_return_id = v_ret.id;

  IF v_invoice IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.sale_invoices s
      WHERE s.id = v_invoice
        AND s.company_id = v_company_id
        AND s.party_id = v_party
        AND s.status = 'posted'
    ) THEN
      RAISE EXCEPTION 'Sale return must use the same customer as the posted invoice';
    END IF;
  END IF;

  UPDATE public.sale_returns SET
    return_date = v_date,
    party_id = v_party,
    warehouse_id = v_wh,
    sale_invoice_id = v_invoice,
    subtotal = coalesce((p_payload->>'subtotal')::numeric, 0),
    discount_total = coalesce((p_payload->>'discount_total')::numeric, 0),
    extra_discount = v_extra,
    grand_total = v_total,
    narration = nullif(p_payload->>'narration', ''),
    updated_at = now()
  WHERE id = v_ret.id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  LOOP
    v_product := (v_item->>'product_id')::uuid;
    v_qty := abs(coalesce((v_item->>'qty')::numeric, 0));
    v_bonus := greatest(0, coalesce((v_item->>'bonus_qty')::numeric, 0));
    v_name := coalesce(nullif(v_item->>'product_name', ''), nullif(v_item->>'product_code', ''), 'item');

    IF v_invoice IS NOT NULL THEN
      SELECT coalesce(sum(i.qty), 0), coalesce(sum(i.bonus_qty), 0)
        INTO v_sold_qty, v_sold_bonus
      FROM public.sale_invoice_items i
      WHERE i.sale_invoice_id = v_invoice AND i.product_id = v_product;

      SELECT coalesce(sum(ri.qty), 0), coalesce(sum(ri.bonus_qty), 0)
        INTO v_ret_qty, v_ret_bonus
      FROM public.sale_return_items ri
      JOIN public.sale_returns r ON r.id = ri.sale_return_id
      WHERE r.sale_invoice_id = v_invoice
        AND r.status = 'posted'
        AND r.id <> v_ret.id
        AND ri.product_id = v_product;

      IF v_sold_qty = 0 AND v_sold_bonus = 0 THEN
        RAISE EXCEPTION 'Product % is not on that sale invoice', v_name;
      END IF;
      IF v_ret_qty + v_qty > v_sold_qty + 0.0005 THEN
        RAISE EXCEPTION 'Return qty for % is more than that invoice still has', v_name;
      END IF;
      IF v_ret_bonus + v_bonus > v_sold_bonus + 0.0005 THEN
        RAISE EXCEPTION 'Return free qty for % is more than that invoice still has', v_name;
      END IF;
    END IF;

    INSERT INTO public.sale_return_items (
      sale_return_id, company_id, product_id, product_code, product_name,
      qty, bonus_qty, rate, discount, amount, sort_order
    ) VALUES (
      v_ret.id, v_company_id, v_product, v_item->>'product_code', v_item->>'product_name',
      v_qty, v_bonus, coalesce((v_item->>'rate')::numeric, 0),
      coalesce((v_item->>'discount')::numeric, 0),
      coalesce((v_item->>'amount')::numeric, 0), v_idx
    );
    PERFORM private.apply_stock_delta(
      v_company_id, v_wh, v_product,
      v_qty + v_bonus, 'sale_return', 'sale_returns', v_ret.id, true
    );
    v_idx := v_idx + 1;
  END LOOP;

  PERFORM private.post_ledger(
    v_org_id, v_company_id, v_party, v_date, 0, v_total,
    'Sale return ' || v_ret.return_no, 'sale_returns', v_ret.id, 'SR'
  );
  RETURN v_ret.id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_sale_return(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_sale_return(jsonb) TO authenticated, service_role;
