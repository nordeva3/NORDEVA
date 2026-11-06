-- Fix: migration 20260714144724 revoked EXECUTE on has_role from everyone and
-- never re-granted it, so every RLS/storage policy that calls has_role()
-- failed for signed-in users ("permission denied for function has_role") —
-- most visibly, sellers could not upload product files (listing-files bucket).
-- The anon grant was restored earlier; restore the remaining roles.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
