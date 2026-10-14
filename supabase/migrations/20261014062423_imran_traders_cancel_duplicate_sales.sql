-- Imran Traders: cancel duplicate posted sale invoices from sync burst (14 Oct 2025 PKT).
-- Keep SI-0002 (Ahmad Bartan) and SI-0005 (Saifal); cancel SI-0006–SI-0009.
-- Uses inline reversal (migrations have no auth.uid() for can_write_company).

DO $$
DECLARE
  v_company uuid := 'db7c712e-ba2e-4635-95d6-8b5b2cb3dacd';
  v_cancel uuid[] := ARRAY[
    '13827ff3-1f75-4502-b25b-af903e29b170'::uuid,
    '4a681d13-69b6-49e0-b25b-28ce138b0e6a'::uuid,
    '7c5c948d-76c3-4e19-baa7-864cbb5a2570'::uuid,
    'afcd07a7-5a9b-44e3-ab09-76b2a14538c5'::uuid
  ];
  inv_id uuid;
  v_inv public.sale_invoices%rowtype;
  v_item public.sale_invoice_items%rowtype;
  v_stock_wh uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = v_company AND name = 'Imran Traders'
  ) THEN
    RAISE NOTICE 'Imran Traders company not found — skipping data repair';
    RETURN;
  END IF;

  FOREACH inv_id IN ARRAY v_cancel
  LOOP
    SELECT * INTO v_inv
    FROM public.sale_invoices
    WHERE id = inv_id
      AND company_id = v_company;

    IF NOT FOUND OR v_inv.status <> 'posted' THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.sale_returns r
      WHERE r.sale_invoice_id = v_inv.id
        AND r.status = 'posted'
    ) THEN
      RAISE EXCEPTION 'Sale return posted against %', v_inv.invoice_no;
    END IF;

    FOR v_item IN
      SELECT * FROM public.sale_invoice_items WHERE sale_invoice_id = v_inv.id
    LOOP
      SELECT coalesce(p.default_warehouse_id, v_inv.warehouse_id)
        INTO v_stock_wh
      FROM public.products p
      WHERE p.id = v_item.product_id;
      IF v_stock_wh IS NULL THEN
        v_stock_wh := v_inv.warehouse_id;
      END IF;
      PERFORM private.apply_stock_delta(
        v_inv.company_id,
        v_stock_wh,
        v_item.product_id,
        abs(v_item.qty) + coalesce(v_item.bonus_qty, 0),
        'adjustment',
        'sale_invoices',
        v_inv.id,
        true
      );
    END LOOP;

    PERFORM private.post_ledger(
      v_inv.organization_id, v_inv.company_id, v_inv.party_id, v_inv.invoice_date,
      0, v_inv.grand_total,
      'Cancel sale ' || v_inv.invoice_no,
      'sale_invoices', v_inv.id, 'SI'
    );

    IF coalesce(v_inv.amount_paid, 0) > 0 THEN
      PERFORM private.post_ledger(
        v_inv.organization_id, v_inv.company_id, v_inv.party_id, v_inv.invoice_date,
        v_inv.amount_paid, 0,
        'Cancel cash on sale ' || v_inv.invoice_no,
        'sale_invoices', v_inv.id, 'CR'
      );
    END IF;

    UPDATE public.sale_invoices
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = v_inv.id;
  END LOOP;
END $$;
