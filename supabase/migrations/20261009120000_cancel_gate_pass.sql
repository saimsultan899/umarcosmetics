-- Gate passes are document-only (no stock/ledger). Table delete from the
-- client fails because RLS has SELECT only — cancel via security definer RPC.

CREATE OR REPLACE FUNCTION public.cancel_gate_pass(p_gate_pass_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_gp public.gate_passes%rowtype;
BEGIN
  SELECT * INTO v_gp FROM public.gate_passes WHERE id = p_gate_pass_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found';
  END IF;
  IF NOT private.can_write_company(v_gp.company_id) THEN
    RAISE EXCEPTION 'No write access';
  END IF;
  IF v_gp.status <> 'posted' THEN
    RAISE EXCEPTION 'This gate pass is already cancelled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_invoices p
    WHERE p.gate_pass_id = v_gp.id
      AND p.status = 'posted'
  ) THEN
    RAISE EXCEPTION 'A purchase invoice is already posted against this gate pass';
  END IF;

  UPDATE public.gate_passes
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_gp.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_gate_pass(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_gate_pass(uuid) TO authenticated, service_role;
