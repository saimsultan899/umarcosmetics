-- Drop legacy overload that auto-attached the calling superadmin
DROP FUNCTION IF EXISTS public.admin_create_company(uuid, text, text, text, text, text, text, text);
