-- VELORA marketplace upgrade — Wave B (additive only).
--
-- Expose the professional profile fields (added to profiles by Wave A) on
-- public_profiles so public creator pages can show headline, skills,
-- languages, experience, availability and hourly rate. public_profiles is
-- the public-safe mirror of profiles (see 20260918050000_production_hardening);
-- profiles itself stays readable only by its owner/admins, and the profile
-- completion percentage is NEVER copied here — it is owner-only by design.
--
-- The sync trigger function is extended with the new columns; the separate
-- verified-status sync (seller_verifications based) is untouched.

ALTER TABLE public.public_profiles
  ADD COLUMN IF NOT EXISTS headline TEXT,
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS experience_level TEXT,
  ADD COLUMN IF NOT EXISTS years_experience INTEGER,
  ADD COLUMN IF NOT EXISTS availability TEXT,
  ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);

-- Backfill from profiles for existing rows.
UPDATE public.public_profiles pp
SET headline = p.headline,
    cover_url = p.cover_url,
    skills = COALESCE(p.skills, '{}'),
    languages = COALESCE(p.languages, '{}'),
    experience_level = p.experience_level,
    years_experience = p.years_experience,
    availability = p.availability,
    hourly_rate = p.hourly_rate
FROM public.profiles p
WHERE pp.id = p.id;

CREATE OR REPLACE FUNCTION public.sync_public_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.public_profiles WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.public_profiles (
    id, display_name, username, avatar_url, bio, website_url, twitter_url, github_url,
    headline, cover_url, skills, languages, experience_level, years_experience,
    availability, hourly_rate, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.display_name, NEW.username, NEW.avatar_url, NEW.bio, NEW.website_url,
    NEW.twitter_url, NEW.github_url,
    NEW.headline, NEW.cover_url, COALESCE(NEW.skills, '{}'), COALESCE(NEW.languages, '{}'),
    NEW.experience_level, NEW.years_experience, NEW.availability, NEW.hourly_rate,
    NEW.created_at, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    username = EXCLUDED.username,
    avatar_url = EXCLUDED.avatar_url,
    bio = EXCLUDED.bio,
    website_url = EXCLUDED.website_url,
    twitter_url = EXCLUDED.twitter_url,
    github_url = EXCLUDED.github_url,
    headline = EXCLUDED.headline,
    cover_url = EXCLUDED.cover_url,
    skills = EXCLUDED.skills,
    languages = EXCLUDED.languages,
    experience_level = EXCLUDED.experience_level,
    years_experience = EXCLUDED.years_experience,
    availability = EXCLUDED.availability,
    hourly_rate = EXCLUDED.hourly_rate,
    updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_public_profile() FROM PUBLIC, anon, authenticated;
