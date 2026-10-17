-- Opening qty was saved on products but never landed in stock_balances
-- (sale invoice still shows on hand 0). Seed live stock for products that
-- have opening qty, zero on-hand, and no purchase/sale stock movements.
-- Spokes are skipped — shared stock lives on the hub product.

DO $$
DECLARE
  r record;
  v_onhand numeric;
  v_seeded int := 0;
BEGIN
  FOR r IN
    SELECT p.id, p.company_id, p.default_warehouse_id, p.opening_qty, p.code
    FROM public.products p
    WHERE coalesce(p.opening_qty, 0) <> 0
      AND p.default_warehouse_id IS NOT NULL
      AND p.hub_product_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.move_type IS DISTINCT FROM 'adjustment'
      )
  LOOP
    SELECT coalesce(sum(sb.qty), 0) INTO v_onhand
    FROM public.stock_balances sb
    WHERE sb.company_id = r.company_id
      AND sb.warehouse_id = r.default_warehouse_id
      AND sb.product_id = r.id;

    IF abs(v_onhand) > 0.0005 THEN
      CONTINUE;
    END IF;

    DELETE FROM public.stock_movements
    WHERE product_id = r.id
      AND move_type = 'adjustment'
      AND ref_table = 'products'
      AND ref_id = r.id;

    UPDATE public.stock_balances
    SET qty = 0, updated_at = now()
    WHERE company_id = r.company_id
      AND warehouse_id = r.default_warehouse_id
      AND product_id = r.id;

    PERFORM private.apply_stock_delta(
      r.company_id,
      r.default_warehouse_id,
      r.id,
      r.opening_qty,
      'adjustment',
      'products',
      r.id,
      true
    );
    v_seeded := v_seeded + 1;
  END LOOP;

  RAISE NOTICE 'Seeded opening stock for % products', v_seeded;
END $$;
