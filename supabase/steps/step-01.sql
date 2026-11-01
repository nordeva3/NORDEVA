-- ============================================================
-- NORDEVA setup - STEP 1 of 11
-- Is step ko poora copy karke Supabase SQL Editor me Run karo.
-- ============================================================

-- ===== 20260702133215_338818fb-8fb0-46e0-b66f-bfc4f76597a2.sql =====

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- LISTINGS
CREATE TYPE public.listing_kind AS ENUM ('software', 'website');
CREATE TABLE public.listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.listing_kind NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  cover_url TEXT,
  demo_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.listings (kind);
CREATE INDEX ON public.listings (seller_id);
GRANT SELECT ON public.listings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.listings TO authenticated;
GRANT ALL ON public.listings TO service_role;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "listings public read" ON public.listings FOR SELECT USING (true);
CREATE POLICY "seller insert" ON public.listings FOR INSERT WITH CHECK (auth.uid() = seller_id);
CREATE POLICY "seller update" ON public.listings FOR UPDATE USING (auth.uid() = seller_id) WITH CHECK (auth.uid() = seller_id);
CREATE POLICY "seller delete" ON public.listings FOR DELETE USING (auth.uid() = seller_id);

-- ORDERS
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  buyer_email TEXT NOT NULL,
  buyer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL,
  platform_fee NUMERIC(12,2) NOT NULL,
  seller_earnings NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.orders (seller_id);
CREATE INDEX ON public.orders (buyer_id);
GRANT SELECT, INSERT ON public.orders TO authenticated;
GRANT INSERT ON public.orders TO anon;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seller reads own orders" ON public.orders FOR SELECT USING (auth.uid() = seller_id OR auth.uid() = buyer_id);
CREATE POLICY "anyone can create order" ON public.orders FOR INSERT WITH CHECK (true);

-- Notify seller on new order
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.notifications (user_id, created_at DESC);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own notifications update" ON public.notifications FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.notify_seller_new_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l_title TEXT;
BEGIN
  SELECT title INTO l_title FROM public.listings WHERE id = NEW.listing_id;
  INSERT INTO public.notifications (user_id, title, body)
  VALUES (NEW.seller_id, 'New sale: ' || COALESCE(l_title,'listing'),
          'You earned ' || NEW.seller_earnings::text || ' ' || NEW.currency);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notify_seller AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.notify_seller_new_order();

-- PAYOUT METHODS
CREATE TABLE public.payout_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method_type TEXT NOT NULL, -- 'upi' | 'bank'
  upi_number TEXT,
  bank_account_number TEXT,
  bank_name TEXT,
  bank_ifsc TEXT,
  account_holder_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payout_methods TO authenticated;
GRANT ALL ON public.payout_methods TO service_role;
ALTER TABLE public.payout_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own payout methods" ON public.payout_methods FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- PAYOUT REQUESTS
CREATE TABLE public.payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL,
  method_id UUID REFERENCES public.payout_methods(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.payout_requests TO authenticated;
GRANT ALL ON public.payout_requests TO service_role;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own payout requests" ON public.payout_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert own payout requests" ON public.payout_requests FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ===== 20260702133251_79a960c0-92c7-4f51-b20b-5cb4b044b58e.sql =====

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_seller_new_order() FROM PUBLIC, anon, authenticated;

-- ===== 20260702133319_306ca9a5-41f9-47ca-9f3f-96a5f8523f7c.sql =====

DROP POLICY IF EXISTS "anyone can create order" ON public.orders;
CREATE POLICY "buyers create own or anon orders" ON public.orders
  FOR INSERT WITH CHECK (
    (buyer_id IS NULL AND auth.uid() IS NULL)
    OR (buyer_id = auth.uid())
  );

-- ===== 20260709160450_b91772d7-5449-4840-b5ea-e18e30406c40.sql =====

-- 1) Validate listings.demo_url scheme
CREATE OR REPLACE FUNCTION public.validate_listing_urls()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.demo_url IS NOT NULL AND NEW.demo_url <> '' THEN
    IF NOT (NEW.demo_url ~* '^https?://') THEN
      RAISE EXCEPTION 'demo_url must start with http:// or https://';
    END IF;
  END IF;
  IF NEW.cover_url IS NOT NULL AND NEW.cover_url <> '' THEN
    IF NOT (NEW.cover_url ~* '^(https?://|data:image/)') THEN
      RAISE EXCEPTION 'cover_url must be an http(s) or data:image URL';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listings_validate_urls ON public.listings;
CREATE TRIGGER listings_validate_urls
BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.validate_listing_urls();

-- 2) Recompute order financial fields from listings
CREATE OR REPLACE FUNCTION public.enforce_order_financials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l_price NUMERIC;
  l_currency TEXT;
  l_seller UUID;
  l_status TEXT;
  fee NUMERIC;
BEGIN
  SELECT price, currency, seller_id, status
    INTO l_price, l_currency, l_seller, l_status
  FROM public.listings WHERE id = NEW.listing_id;

  IF l_price IS NULL THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;
  IF l_status <> 'active' THEN
    RAISE EXCEPTION 'Listing is not available for purchase';
  END IF;

  NEW.amount := l_price;
  NEW.currency := l_currency;
  NEW.seller_id := l_seller;
  fee := ROUND((l_price * 0.03)::numeric, 2);
  NEW.platform_fee := fee;
  NEW.seller_earnings := l_price - fee;
  NEW.status := 'completed';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_enforce_financials ON public.orders;
CREATE TRIGGER orders_enforce_financials
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_financials();

-- 3) Validate payout request against real balance
CREATE OR REPLACE FUNCTION public.enforce_payout_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  earned NUMERIC;
  withdrawn NUMERIC;
  available NUMERIC;
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Payout amount must be positive';
  END IF;

  SELECT COALESCE(SUM(seller_earnings), 0) INTO earned
  FROM public.orders
  WHERE seller_id = NEW.user_id
    AND currency = NEW.currency
    AND status = 'completed';

  SELECT COALESCE(SUM(amount), 0) INTO withdrawn
  FROM public.payout_requests
  WHERE user_id = NEW.user_id
    AND currency = NEW.currency
    AND status <> 'rejected';

  available := earned - withdrawn;

  IF NEW.amount > available THEN
    RAISE EXCEPTION 'Requested amount % exceeds available balance %', NEW.amount, available;
  END IF;

  NEW.status := 'pending';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payout_requests_enforce_balance ON public.payout_requests;
CREATE TRIGGER payout_requests_enforce_balance
BEFORE INSERT ON public.payout_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_payout_balance();

-- ===== 20260709160514_ed34d912-61cb-4fc0-9bdd-14fe87fb24f5.sql =====

REVOKE EXECUTE ON FUNCTION public.enforce_order_financials() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_payout_balance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_listing_urls() FROM PUBLIC, anon, authenticated;

-- ===== 20260711092500_b425f773-9c8a-4e44-bc84-fd80ef8cedae.sql =====

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS file_path text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_size bigint;

-- Seller can insert/update/delete their own objects (folder = their user id)
CREATE POLICY "listing-files seller insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'listing-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "listing-files seller update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'listing-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "listing-files seller delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'listing-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "listing-files seller read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'listing-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ===== 20260712052304_6205dacd-8832-4c87-a3e7-ca86f6b600eb.sql =====

-- Roles
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','moderator','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own roles" ON public.user_roles;
CREATE POLICY "read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Seed admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users WHERE email = 'nebulasoftwareplat@gmail.com'
ON CONFLICT DO NOTHING;

-- Delete all existing listings
DELETE FROM public.listings;

-- Add FK for PostgREST embedding profiles
ALTER TABLE public.listings
  DROP CONSTRAINT IF EXISTS listings_seller_id_fkey;
ALTER TABLE public.listings
  ADD CONSTRAINT listings_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Only admins can delete listings
DROP POLICY IF EXISTS "seller delete" ON public.listings;
DROP POLICY IF EXISTS "admin delete" ON public.listings;
CREATE POLICY "admin delete" ON public.listings
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ===== 20260713125946_ccf64319-7f4e-4006-a65e-73179b99fb06.sql =====

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

-- ===== 20260713130011_92f3d10c-20fd-4252-a3f7-9f6dcd64892d.sql =====

REVOKE EXECUTE ON FUNCTION public.enforce_listing_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_profile_username() FROM PUBLIC, anon, authenticated;

-- ===== 20260714093000_8f548aff-15d3-4b81-8d04-b552c1d91aeb.sql =====

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  meta_username TEXT;
  meta_display TEXT;
BEGIN
  meta_username := NULLIF(NEW.raw_user_meta_data->>'username', '');
  meta_display := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    meta_username,
    split_part(NEW.email, '@', 1)
  );

  -- Only accept a username that matches the format rule; ignore silently otherwise
  IF meta_username IS NOT NULL AND meta_username !~ '^[A-Za-z0-9_]{3,20}$' THEN
    meta_username := NULL;
  END IF;

  INSERT INTO public.profiles (id, email, display_name, username)
  VALUES (NEW.id, NEW.email, meta_display, meta_username)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  -- Username taken: create the profile without it so the account still works
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, meta_display)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Ensure the trigger exists (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== 20260714093025_21b585fd-07fb-4c22-ae79-20b3fee022d5.sql =====

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
