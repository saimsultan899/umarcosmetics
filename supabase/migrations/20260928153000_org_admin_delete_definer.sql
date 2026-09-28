-- The permission trigger calls helpers in schema private. Company logins
-- have no access to that schema, so the delete failed before the
-- organization-admin check. Run the check as the function owner.

ALTER FUNCTION private.guard_record_permission() SECURITY DEFINER;
