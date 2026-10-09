-- When an org has a main company, stock for spoke (linked) products
-- lives on the main product. Sales/purchases/opening on Ishaq/Umar
-- therefore update Imran's stock_balances, and on-hand checks read there.
--
-- Applied remotely as hub_shared_stock_for_spokes; kept here for repo history.

CREATE OR REPLACE FUNCTION private.resolve_shared_stock_target(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid
)
RETURNS TABLE (
  company_id uuid,
  warehouse_id uuid,
  product_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_main uuid;
  v_hub_product uuid;
  v_hub_wh uuid;
  v_prod public.products%ROWTYPE;
BEGIN
  IF p_product_id IS NULL THEN
    company_id := p_company_id;
    warehouse_id := p_warehouse_id;
    product_id := p_product_id;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    company_id := p_company_id;
    warehouse_id := p_warehouse_id;
    product_id := p_product_id;
    RETURN NEXT;
    RETURN;
  END IF;

  v_main := private.org_main_company_id(v_prod.company_id);
  IF v_main IS NULL THEN
    company_id := p_company_id;
    warehouse_id := p_warehouse_id;
    product_id := p_product_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_prod.company_id = v_main THEN
    company_id := v_main;
    warehouse_id := p_warehouse_id;
    product_id := p_product_id;
    RETURN NEXT;
    RETURN;
  END IF;

  v_hub_product := private.ensure_hub_product(p_product_id);
  IF v_hub_product IS NULL THEN
    company_id := p_company_id;
    warehouse_id := p_warehouse_id;
    product_id := p_product_id;
    RETURN NEXT;
    RETURN;
  END IF;

  v_hub_wh := private.ensure_hub_warehouse(p_warehouse_id, v_main);
  IF v_hub_wh IS NULL THEN
    SELECT default_warehouse_id INTO v_hub_wh
    FROM public.products WHERE id = v_hub_product;
  END IF;

  company_id := v_main;
  warehouse_id := coalesce(v_hub_wh, p_warehouse_id);
  product_id := v_hub_product;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION private.shared_stock_on_hand(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_target record;
  v_qty numeric;
BEGIN
  SELECT * INTO v_target
  FROM private.resolve_shared_stock_target(p_company_id, p_warehouse_id, p_product_id);

  IF v_target.warehouse_id IS NULL OR v_target.product_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT coalesce(sb.qty, 0) INTO v_qty
  FROM public.stock_balances sb
  WHERE sb.company_id = v_target.company_id
    AND sb.warehouse_id = v_target.warehouse_id
    AND sb.product_id = v_target.product_id;

  RETURN coalesce(v_qty, 0);
END;
$function$;
