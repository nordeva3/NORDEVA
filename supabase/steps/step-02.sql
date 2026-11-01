-- ============================================================
-- NORDEVA setup - STEP 2 of 11
-- Is step ko poora copy karke Supabase SQL Editor me Run karo.
-- ============================================================

-- ===== 20260714144700_5887d3f7-0eac-4739-9bcf-6e66e5a86210.sql =====

-- 1) Attach missing triggers so existing enforcement functions actually run

DROP TRIGGER IF EXISTS trg_enforce_order_financials ON public.orders;
CREATE TRIGGER trg_enforce_order_financials
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_financials();

DROP TRIGGER IF EXISTS trg_notify_seller_new_order ON public.orders;
CREATE TRIGGER trg_notify_seller_new_order
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_seller_new_order();

DROP TRIGGER IF EXISTS trg_enforce_payout_balance ON public.payout_requests;
CREATE TRIGGER trg_enforce_payout_balance
BEFORE INSERT OR UPDATE ON public.payout_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_payout_balance();

DROP TRIGGER IF EXISTS trg_validate_listing_urls ON public.listings;
CREATE TRIGGER trg_validate_listing_urls
BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.validate_listing_urls();

DROP TRIGGER IF EXISTS trg_enforce_listing_status ON public.listings;
CREATE TRIGGER trg_enforce_listing_status
BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.enforce_listing_status();

DROP TRIGGER IF EXISTS trg_validate_profile_username ON public.profiles;
CREATE TRIGGER trg_validate_profile_username
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_profile_username();

-- 2) Harden demo_url / cover_url validation against javascript: and other unsafe schemes
CREATE OR REPLACE FUNCTION public.validate_listing_urls()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.demo_url IS NOT NULL AND NEW.demo_url <> '' THEN
    IF NOT (NEW.demo_url ~* '^https?://[^\s]+$') THEN
      RAISE EXCEPTION 'demo_url must be a valid http(s) URL';
    END IF;
    IF NEW.demo_url ~* '^\s*javascript:' OR NEW.demo_url ~* '^\s*data:' OR NEW.demo_url ~* '^\s*vbscript:' OR NEW.demo_url ~* '^\s*file:' THEN
      RAISE EXCEPTION 'demo_url scheme is not allowed';
    END IF;
  END IF;
  IF NEW.cover_url IS NOT NULL AND NEW.cover_url <> '' THEN
    IF NOT (NEW.cover_url ~* '^(https?://|data:image/)') THEN
      RAISE EXCEPTION 'cover_url must be an http(s) or data:image URL';
    END IF;
    IF NEW.cover_url ~* '^\s*javascript:' OR NEW.cover_url ~* '^\s*vbscript:' OR NEW.cover_url ~* '^\s*file:' THEN
      RAISE EXCEPTION 'cover_url scheme is not allowed';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- CHECK constraint as belt-and-suspenders against javascript: URIs
ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_demo_url_safe;
ALTER TABLE public.listings ADD CONSTRAINT listings_demo_url_safe
  CHECK (demo_url IS NULL OR demo_url = '' OR demo_url ~* '^https?://');

ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_cover_url_safe;
ALTER TABLE public.listings ADD CONSTRAINT listings_cover_url_safe
  CHECK (cover_url IS NULL OR cover_url = '' OR cover_url ~* '^(https?://|data:image/)');

-- 3) Revoke public EXECUTE on internal SECURITY DEFINER functions.
-- These are only invoked by triggers or admin paths; the definer bypasses this revoke.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_seller_new_order() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_order_financials() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_payout_balance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_listing_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_listing_urls() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_profile_username() FROM PUBLIC, anon, authenticated;

-- has_role is used inside RLS policies (SECURITY DEFINER makes it evaluate regardless of caller grants),
-- but revoke direct RPC access from anon; keep authenticated so app can check its own role via RPC if needed.
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, anon;

-- ===== 20260714144724_222d2a98-5204-4bab-980b-b5d738589fe5.sql =====
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;

-- ===== 20260717114322_ef11c912-0014-479a-9de3-0c9ff3bc04c8.sql =====
CREATE TABLE public.website_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  budget NUMERIC(12,2) NOT NULL CHECK (budget >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','taken','completed','cancelled')),
  taken_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  taken_at TIMESTAMPTZ,
  contact TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_requests TO authenticated;
GRANT SELECT ON public.website_requests TO anon;
GRANT ALL ON public.website_requests TO service_role;

ALTER TABLE public.website_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view requests"
  ON public.website_requests FOR SELECT
  USING (true);

CREATE POLICY "Users can create their own requests"
  ON public.website_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Requester can update own request"
  ON public.website_requests FOR UPDATE
  TO authenticated
  USING (auth.uid() = requester_id)
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Taker can claim or update taken request"
  ON public.website_requests FOR UPDATE
  TO authenticated
  USING (
    (status = 'open' AND taken_by IS NULL)
    OR auth.uid() = taken_by
  )
  WITH CHECK (
    auth.uid() = taken_by
  );

CREATE POLICY "Requester can delete own request"
  ON public.website_requests FOR DELETE
  TO authenticated
  USING (auth.uid() = requester_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_website_requests_updated_at
  BEFORE UPDATE ON public.website_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX website_requests_status_idx ON public.website_requests (status, created_at DESC);

-- ===== 20260717120356_ceaadaba-8aaf-45c9-82d7-bdd412850fa3.sql =====

ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS review_note TEXT;

CREATE OR REPLACE FUNCTION public.enforce_listing_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Sellers cannot self-publish
    IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
      NEW.status := 'pending';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND auth.uid() IS NOT NULL
       AND NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Only admins can change listing status';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ===== 20260719051034_dcd3e4ef-e64f-4e2c-af7e-d971048bac7a.sql =====

ALTER TABLE public.website_requests
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'normal'
    CHECK (tier IN ('normal','advanced','high_end')),
  ADD COLUMN IF NOT EXISTS photos text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (array_length(photos, 1) IS NULL OR array_length(photos, 1) <= 6);

-- Storage policies for request-photos bucket
CREATE POLICY "Users upload own request photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'request-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users update own request photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'request-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users delete own request photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'request-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Authenticated can read request photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'request-photos');

-- ===== 20260804092936_094e2e1c-7300-4144-b749-0d9682f3272b.sql =====
-- profile enrichment
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS twitter_url TEXT,
  ADD COLUMN IF NOT EXISTS github_url TEXT;

-- REVIEWS
CREATE TABLE IF NOT EXISTS public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, user_id)
);
GRANT SELECT ON public.reviews TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reviews public read" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "verified buyers insert review" ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.listing_id = reviews.listing_id
        AND o.buyer_id = auth.uid()
        AND o.status = 'completed'
    )
  );
CREATE POLICY "authors update own review" ON public.reviews FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "authors delete own review" ON public.reviews FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- HELPFUL MARKS
CREATE TABLE IF NOT EXISTS public.review_helpful (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (review_id, user_id)
);
GRANT SELECT ON public.review_helpful TO anon;
GRANT SELECT, INSERT, DELETE ON public.review_helpful TO authenticated;
GRANT ALL ON public.review_helpful TO service_role;
ALTER TABLE public.review_helpful ENABLE ROW LEVEL SECURITY;
CREATE POLICY "helpful public read" ON public.review_helpful FOR SELECT USING (true);
CREATE POLICY "helpful insert own" ON public.review_helpful FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "helpful delete own" ON public.review_helpful FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- FOLLOWS
CREATE TABLE IF NOT EXISTS public.follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (follower_id, creator_id),
  CHECK (follower_id <> creator_id)
);
GRANT SELECT ON public.follows TO anon;
GRANT SELECT, INSERT, DELETE ON public.follows TO authenticated;
GRANT ALL ON public.follows TO service_role;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "follows public read" ON public.follows FOR SELECT USING (true);
CREATE POLICY "follows insert own" ON public.follows FOR INSERT TO authenticated WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "follows delete own" ON public.follows FOR DELETE TO authenticated USING (auth.uid() = follower_id);

-- VERSION HISTORY
CREATE TABLE IF NOT EXISTS public.listing_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.listing_versions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_versions TO authenticated;
GRANT ALL ON public.listing_versions TO service_role;
ALTER TABLE public.listing_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "versions public read" ON public.listing_versions FOR SELECT USING (true);
CREATE POLICY "seller manages versions" ON public.listing_versions FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_versions.listing_id AND l.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_versions.listing_id AND l.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

-- AGGREGATE STATS (no private rows exposed)
CREATE OR REPLACE VIEW public.listing_stats AS
SELECT
  l.id AS listing_id,
  (SELECT count(*) FROM public.orders o WHERE o.listing_id = l.id AND o.status = 'completed') AS sales_count,
  (SELECT count(*) FROM public.reviews r WHERE r.listing_id = l.id) AS rating_count,
  (SELECT round(avg(r.rating)::numeric, 2) FROM public.reviews r WHERE r.listing_id = l.id) AS rating_avg
FROM public.listings l;
GRANT SELECT ON public.listing_stats TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.creator_stats AS
SELECT
  p.id AS creator_id,
  (SELECT count(*) FROM public.listings l WHERE l.seller_id = p.id AND l.status = 'active') AS products,
  (SELECT count(*) FROM public.follows f WHERE f.creator_id = p.id) AS followers,
  (SELECT count(*) FROM public.orders o WHERE o.seller_id = p.id AND o.status = 'completed') AS sales,
  (SELECT round(avg(r.rating)::numeric, 2) FROM public.reviews r
     JOIN public.listings l2 ON l2.id = r.listing_id WHERE l2.seller_id = p.id) AS rating_avg
FROM public.profiles p;
GRANT SELECT ON public.creator_stats TO anon, authenticated, service_role;

-- ===== 20260804093015_923f5961-ea62-4c98-ab8f-76b8e0f9e71d.sql =====
DROP VIEW IF EXISTS public.listing_stats;
DROP VIEW IF EXISTS public.creator_stats;

ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS sales_count INTEGER NOT NULL DEFAULT 0;

UPDATE public.listings l
SET sales_count = (SELECT count(*) FROM public.orders o WHERE o.listing_id = l.id AND o.status = 'completed');

CREATE OR REPLACE FUNCTION public.bump_listing_sales_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    UPDATE public.listings SET sales_count = sales_count + 1 WHERE id = NEW.listing_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bump_listing_sales_count() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bump_listing_sales_count ON public.orders;
CREATE TRIGGER trg_bump_listing_sales_count
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.bump_listing_sales_count();

-- ===== 20260807154855_27b262f4-bc1e-47cb-a3d1-ede44c0af588.sql =====
-- listings: new product fields
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS version text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS docs_url text,
  ADD COLUMN IF NOT EXISTS screenshots text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS views_count integer NOT NULL DEFAULT 0;

-- allow drafts: sellers may only set draft or pending
CREATE OR REPLACE FUNCTION public.enforce_listing_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
      IF NEW.status IS DISTINCT FROM 'draft' THEN
        NEW.status := 'pending';
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND auth.uid() IS NOT NULL
       AND NOT public.has_role(auth.uid(), 'admin') THEN
      IF NOT (OLD.status = 'draft' AND NEW.status IN ('draft', 'pending')) THEN
        RAISE EXCEPTION 'Only admins can change listing status';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- sellers see their own hidden (draft/pending/rejected) listings
DROP POLICY IF EXISTS "seller reads own listings" ON public.listings;
CREATE POLICY "seller reads own listings" ON public.listings
  FOR SELECT TO authenticated USING (auth.uid() = seller_id);

-- sellers may delete their own listings that have never sold
DROP POLICY IF EXISTS "seller deletes unsold listing" ON public.listings;
CREATE POLICY "seller deletes unsold listing" ON public.listings
  FOR DELETE TO authenticated USING (auth.uid() = seller_id AND sales_count = 0);

-- encrypted private delivery vault (server-only)
CREATE TABLE IF NOT EXISTS public.listing_private_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL UNIQUE REFERENCES public.listings(id) ON DELETE CASCADE,
  content_ciphertext text,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.listing_private_delivery TO service_role;
ALTER TABLE public.listing_private_delivery ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS lpd_updated_at ON public.listing_private_delivery;
CREATE TRIGGER lpd_updated_at BEFORE UPDATE ON public.listing_private_delivery
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- wishlists
CREATE TABLE IF NOT EXISTS public.wishlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, listing_id)
);
GRANT SELECT, INSERT, DELETE ON public.wishlists TO authenticated;
GRANT ALL ON public.wishlists TO service_role;
ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own wishlist" ON public.wishlists FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own wishlist insert" ON public.wishlists FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own wishlist delete" ON public.wishlists FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- cart
CREATE TABLE IF NOT EXISTS public.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, listing_id)
);
GRANT SELECT, INSERT, DELETE ON public.cart_items TO authenticated;
GRANT ALL ON public.cart_items TO service_role;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cart" ON public.cart_items FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own cart insert" ON public.cart_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own cart delete" ON public.cart_items FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- reports
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or admin reports read" ON public.reports FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "insert own report" ON public.reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- reviews: images, seller reply, edit stamp
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS seller_reply text,
  ADD COLUMN IF NOT EXISTS seller_replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

DROP POLICY IF EXISTS "seller replies to review" ON public.reviews;
CREATE POLICY "seller replies to review" ON public.reviews FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.listings l WHERE l.id = reviews.listing_id AND l.seller_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.listings l WHERE l.id = reviews.listing_id AND l.seller_id = auth.uid()));

-- real view tracking
CREATE TABLE IF NOT EXISTS public.listing_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  viewer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.listing_views TO anon, authenticated;
GRANT SELECT ON public.listing_views TO authenticated;
GRANT ALL ON public.listing_views TO service_role;
ALTER TABLE public.listing_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone records a view" ON public.listing_views FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "seller reads own views" ON public.listing_views FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_views.listing_id AND l.seller_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.bump_listing_views()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.listings SET views_count = views_count + 1 WHERE id = NEW.listing_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bump_listing_views() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_bump_listing_views ON public.listing_views;
CREATE TRIGGER trg_bump_listing_views AFTER INSERT ON public.listing_views
  FOR EACH ROW EXECUTE FUNCTION public.bump_listing_views();

CREATE INDEX IF NOT EXISTS idx_listing_views_listing ON public.listing_views(listing_id);
CREATE INDEX IF NOT EXISTS idx_listings_status_created ON public.listings(status, created_at DESC);

-- ===== 20260914211900_harden_orders.sql =====
-- Security hardening: an order is proof of a completed payment.
-- Clients must never be able to manufacture completed orders directly.
REVOKE INSERT ON public.orders FROM anon, authenticated;
DROP POLICY IF EXISTS "anyone can create order" ON public.orders;
DROP POLICY IF EXISTS "buyers create own or anon orders" ON public.orders;

-- Keep order creation available only to trusted server-side payment/webhook code.
GRANT INSERT ON public.orders TO service_role;

-- ===== 20260914213000_razorpay_payments.sql =====
-- Razorpay payment state and webhook idempotency.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'captured',
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_payment_id_uidx
  ON public.orders(provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_provider_order_id_idx
  ON public.orders(provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_events_provider_event_uidx
  ON public.payment_events(provider, provider_event_id);
GRANT ALL ON public.payment_events TO service_role;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- Orders are created only by trusted server/webhook code.
REVOKE INSERT ON public.orders FROM anon, authenticated;
DROP POLICY IF EXISTS "anyone can create order" ON public.orders;
DROP POLICY IF EXISTS "buyers create own or anon orders" ON public.orders;
GRANT INSERT ON public.orders TO service_role;
