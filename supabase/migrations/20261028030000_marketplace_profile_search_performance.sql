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
