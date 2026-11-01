-- ============================================================
-- NORDEVA setup - STEP 7 of 11
-- Is step ko poora copy karke Supabase SQL Editor me Run karo.
-- ============================================================

-- ===== 20261028020000_marketplace_public_profiles_search_verified.sql =====
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

-- ===== 20261028030000_marketplace_profile_search_performance.sql =====
-- Improve substring search used by /people without changing public profile visibility.
-- Supabase commonly keeps managed extensions in the `extensions` schema.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

SET search_path = public, extensions;

CREATE INDEX IF NOT EXISTS public_profiles_display_name_trgm_idx
  ON public.public_profiles USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS public_profiles_username_trgm_idx
  ON public.public_profiles USING gin (username gin_trgm_ops);

COMMENT ON INDEX public.public_profiles_display_name_trgm_idx IS
  'Supports case-insensitive substring discovery of public marketplace profiles.';
COMMENT ON INDEX public.public_profiles_username_trgm_idx IS
  'Supports case-insensitive substring discovery by marketplace username.';

-- ===== 20261031090000_create_missing_storage_buckets.sql =====
-- VELORA completion fix: the original migrations create storage POLICIES for
-- the `listing-files` and `request-photos` buckets but never create the
-- buckets themselves (only `listing-media` was created, in
-- 20260926160000_production_completion.sql). Without this migration the
-- seller upload flow fails on a fresh project with "Bucket not found".
--
-- listing-files: private delivery files (buyers get signed URLs only).
-- request-photos: private photos attached to website requests.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('listing-files', 'listing-files', false, 104857600)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('request-photos', 'request-photos', false, 26214400)
ON CONFLICT (id) DO NOTHING;
