-- VELORA marketplace profile discovery + public verified seller indicator.
-- Additive migration: preserves existing profiles, listings, and verification records.

ALTER TABLE public.public_profiles
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS public_profiles_display_name_lower_idx
  ON public.public_profiles (lower(display_name));
CREATE INDEX IF NOT EXISTS public_profiles_username_lower_idx
  ON public.public_profiles (lower(username));
CREATE INDEX IF NOT EXISTS public_profiles_verified_name_idx
  ON public.public_profiles (verified DESC, lower(display_name));

-- Only verification records approved by the trusted server/admin workflow can
-- set the public badge. The client has no write grant on public_profiles.
UPDATE public.public_profiles pp
SET verified = EXISTS (
  SELECT 1
  FROM public.seller_verifications sv
  WHERE sv.user_id = pp.id AND sv.status = 'verified'
);

CREATE OR REPLACE FUNCTION public.sync_public_profile_verified_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
BEGIN
  target_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  UPDATE public.public_profiles pp
  SET verified = EXISTS (
    SELECT 1 FROM public.seller_verifications sv
    WHERE sv.user_id = target_user_id AND sv.status = 'verified'
  ), updated_at = now()
  WHERE pp.id = target_user_id;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_public_profile_verified_status ON public.seller_verifications;
CREATE TRIGGER trg_sync_public_profile_verified_status
AFTER INSERT OR UPDATE OF status OR DELETE ON public.seller_verifications
FOR EACH ROW EXECUTE FUNCTION public.sync_public_profile_verified_status();

REVOKE ALL ON FUNCTION public.sync_public_profile_verified_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_public_profile_verified_status() TO service_role;
