
-- 1) Wipe listings/orders/notifications
DELETE FROM public.orders;
DELETE FROM public.notifications;
DELETE FROM public.listings;

-- 2) Username on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key
  ON public.profiles (LOWER(username))
  WHERE username IS NOT NULL;

-- Validate username format via trigger (letters/numbers/underscore, 3–20)
CREATE OR REPLACE FUNCTION public.validate_profile_username()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.username IS NOT NULL THEN
    IF NEW.username !~ '^[A-Za-z0-9_]{3,20}$' THEN
      RAISE EXCEPTION 'Username must be 3–20 characters: letters, numbers, or underscore';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_validate_username ON public.profiles;
CREATE TRIGGER profiles_validate_username
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_username();

-- 3) Listing approval flow — new listings start pending; only admins can set active/rejected
ALTER TABLE public.listings
  ALTER COLUMN status SET DEFAULT 'pending';

CREATE OR REPLACE FUNCTION public.enforce_listing_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Sellers cannot self-publish
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      NEW.status := 'pending';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Only admins can change listing status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listings_enforce_status ON public.listings;
CREATE TRIGGER listings_enforce_status
  BEFORE INSERT OR UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_listing_status();

-- Admin can update any listing (approve/reject)
DROP POLICY IF EXISTS "admin update" ON public.listings;
CREATE POLICY "admin update" ON public.listings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
