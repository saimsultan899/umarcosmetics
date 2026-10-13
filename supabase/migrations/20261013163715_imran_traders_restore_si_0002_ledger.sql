-- Imran Traders (Umar Group): duplicate sale invoices SI-0003/SI-0004 were cancelled
-- but left ledger lines on the customer statement. Restore SI-0002 as the one
-- posted credit sale (26,408.99) for Ahmad Bartan (1241).

DO $$
DECLARE
  v_company uuid := 'db7c712e-ba2e-4635-95d6-8b5b2cb3dacd';
  v_keep uuid := 'ce8e6f36-4cd2-4b7b-9113-54cd4f238f0f';
  v_drop uuid[] := ARRAY[
    '8af4f5db-390d-4bff-9e3e-43669d4e33f1'::uuid,
    '2e1d8bea-1ebf-463f-ba4b-b41942663108'::uuid
  ];
  r record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = v_company AND name = 'Imran Traders'
  ) THEN
    RAISE NOTICE 'Imran Traders company not found — skipping data repair';
    RETURN;
  END IF;

  DELETE FROM public.ledger_entries
  WHERE ref_table = 'sale_invoices'
    AND ref_id = ANY(v_drop);

  DELETE FROM public.ledger_entries
  WHERE ref_table = 'sale_invoices'
    AND ref_id = v_keep
    AND credit > 0
    AND narration LIKE 'Cancel sale%';

  DELETE FROM public.stock_movements
  WHERE ref_table = 'sale_invoices'
    AND ref_id = ANY(v_drop);

  FOR r IN
    SELECT sm.company_id, sm.warehouse_id, sm.product_id, sum(sm.qty) AS adj_qty
    FROM public.stock_movements sm
    WHERE sm.ref_table = 'sale_invoices'
      AND sm.ref_id = v_keep
      AND sm.move_type = 'adjustment'
    GROUP BY sm.company_id, sm.warehouse_id, sm.product_id
  LOOP
    UPDATE public.stock_balances
    SET qty = qty - r.adj_qty,
        updated_at = now()
    WHERE company_id = r.company_id
      AND warehouse_id = r.warehouse_id
      AND product_id = r.product_id;
  END LOOP;

  DELETE FROM public.stock_movements
  WHERE ref_table = 'sale_invoices'
    AND ref_id = v_keep
    AND move_type = 'adjustment';

  UPDATE public.sale_invoices
  SET status = 'posted',
      updated_at = now()
  WHERE id = v_keep
    AND company_id = v_company
    AND status = 'cancelled';
END $$;
