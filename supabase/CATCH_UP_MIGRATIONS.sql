-- =====================================================================
-- VELORA CATCH-UP MIGRATIONS (safe to run once in the Supabase SQL Editor)
-- ---------------------------------------------------------------------
-- Applies every database change from 2026-08-04 onward that the live
-- project is missing: the later original migrations (public-profiles
-- verified/search, production hardening, marketplace suite, product
-- studio, payment hardening, storage buckets) PLUS the 2026-10-31
-- feature upgrade (categories, project proposals, workspace, project
-- payments) PLUS the UI-redesign appearance setting support PLUS the
-- 2026-11-01 ecosystem upgrade (direct messages, user blocks, project
-- disputes, profile services, and the agreed-amount checkout fix).
-- Every statement is guarded (IF NOT EXISTS / DROP ... IF EXISTS /
-- ON CONFLICT), and a DROP POLICY IF EXISTS has been auto-inserted
-- before every CREATE POLICY, so already-applied pieces are skipped
-- instead of erroring. Existing data is not deleted.
-- =====================================================================

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

DROP POLICY IF EXISTS "reviews public read" ON public.reviews;

CREATE POLICY "reviews public read" ON public.reviews FOR SELECT USING (true);
DROP POLICY IF EXISTS "verified buyers insert review" ON public.reviews;
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
DROP POLICY IF EXISTS "authors update own review" ON public.reviews;
CREATE POLICY "authors update own review" ON public.reviews FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "authors delete own review" ON public.reviews;
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
DROP POLICY IF EXISTS "helpful public read" ON public.review_helpful;
CREATE POLICY "helpful public read" ON public.review_helpful FOR SELECT USING (true);
DROP POLICY IF EXISTS "helpful insert own" ON public.review_helpful;
CREATE POLICY "helpful insert own" ON public.review_helpful FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "helpful delete own" ON public.review_helpful;
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
DROP POLICY IF EXISTS "follows public read" ON public.follows;
CREATE POLICY "follows public read" ON public.follows FOR SELECT USING (true);
DROP POLICY IF EXISTS "follows insert own" ON public.follows;
CREATE POLICY "follows insert own" ON public.follows FOR INSERT TO authenticated WITH CHECK (auth.uid() = follower_id);
DROP POLICY IF EXISTS "follows delete own" ON public.follows;
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
DROP POLICY IF EXISTS "versions public read" ON public.listing_versions;
CREATE POLICY "versions public read" ON public.listing_versions FOR SELECT USING (true);
DROP POLICY IF EXISTS "seller manages versions" ON public.listing_versions;
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
DROP POLICY IF EXISTS "seller reads own listings" ON public.listings;
CREATE POLICY "seller reads own listings" ON public.listings
  FOR SELECT TO authenticated USING (auth.uid() = seller_id);

-- sellers may delete their own listings that have never sold
DROP POLICY IF EXISTS "seller deletes unsold listing" ON public.listings;
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
DROP POLICY IF EXISTS "own wishlist" ON public.wishlists;
CREATE POLICY "own wishlist" ON public.wishlists FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own wishlist insert" ON public.wishlists;
CREATE POLICY "own wishlist insert" ON public.wishlists FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own wishlist delete" ON public.wishlists;
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
DROP POLICY IF EXISTS "own cart" ON public.cart_items;
CREATE POLICY "own cart" ON public.cart_items FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own cart insert" ON public.cart_items;
CREATE POLICY "own cart insert" ON public.cart_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own cart delete" ON public.cart_items;
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
DROP POLICY IF EXISTS "own or admin reports read" ON public.reports;
CREATE POLICY "own or admin reports read" ON public.reports FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "insert own report" ON public.reports;
CREATE POLICY "insert own report" ON public.reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- reviews: images, seller reply, edit stamp
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS seller_reply text,
  ADD COLUMN IF NOT EXISTS seller_replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

DROP POLICY IF EXISTS "seller replies to review" ON public.reviews;
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
DROP POLICY IF EXISTS "anyone records a view" ON public.listing_views;
CREATE POLICY "anyone records a view" ON public.listing_views FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "seller reads own views" ON public.listing_views;
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

-- ===== 20260918050000_production_hardening.sql =====
-- VELORA Production Hardening (payment provider intentionally unchanged)
-- Safe, additive migration: does not delete marketplace data.

/* -------------------------------------------------------------------------- */
/* Public/private profile split                                               */
/* -------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.public_profiles (
  id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name TEXT,
  username TEXT,
  avatar_url TEXT,
  bio TEXT,
  website_url TEXT,
  twitter_url TEXT,
  github_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.public_profiles (id, display_name, username, avatar_url, bio, website_url, twitter_url, github_url, created_at)
SELECT id, display_name, username, avatar_url, bio, website_url, twitter_url, github_url, created_at
FROM public.profiles
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  username = EXCLUDED.username,
  avatar_url = EXCLUDED.avatar_url,
  bio = EXCLUDED.bio,
  website_url = EXCLUDED.website_url,
  twitter_url = EXCLUDED.twitter_url,
  github_url = EXCLUDED.github_url;

GRANT SELECT ON public.public_profiles TO anon, authenticated;
GRANT ALL ON public.public_profiles TO service_role;
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public profiles readable" ON public.public_profiles;
DROP POLICY IF EXISTS "public profiles readable" ON public.public_profiles;
CREATE POLICY "public profiles readable" ON public.public_profiles FOR SELECT USING (true);

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
    id, display_name, username, avatar_url, bio, website_url, twitter_url, github_url, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.display_name, NEW.username, NEW.avatar_url, NEW.bio, NEW.website_url, NEW.twitter_url, NEW.github_url,
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
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_public_profile ON public.profiles;
CREATE TRIGGER trg_sync_public_profile
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_public_profile();
REVOKE ALL ON FUNCTION public.sync_public_profile() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "profiles readable by all" ON public.profiles;
DROP POLICY IF EXISTS "profiles own read" ON public.profiles;
DROP POLICY IF EXISTS "profiles own read" ON public.profiles;
CREATE POLICY "profiles own read" ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

/* listings/reviews can use public_profiles for PostgREST embeddings */
ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_seller_public_fkey;
ALTER TABLE public.listings
  ADD CONSTRAINT listings_seller_public_fkey
  FOREIGN KEY (seller_id) REFERENCES public.public_profiles(id) ON DELETE NO ACTION;

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_user_public_fkey;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_user_public_fkey
  FOREIGN KEY (user_id) REFERENCES public.public_profiles(id) ON DELETE NO ACTION;

/* -------------------------------------------------------------------------- */
/* Request board privacy + stronger lifecycle rules                           */
/* -------------------------------------------------------------------------- */
DROP POLICY IF EXISTS "Anyone can view requests" ON public.website_requests;
DROP POLICY IF EXISTS "Requester can update own request" ON public.website_requests;
DROP POLICY IF EXISTS "Taker can claim or update taken request" ON public.website_requests;

DROP POLICY IF EXISTS "requester reads own request" ON public.website_requests;

CREATE POLICY "requester reads own request" ON public.website_requests FOR SELECT TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = taken_by OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "requester updates open request" ON public.website_requests;

CREATE POLICY "requester updates open request" ON public.website_requests FOR UPDATE TO authenticated
USING (auth.uid() = requester_id AND status IN ('open','cancelled'))
WITH CHECK (auth.uid() = requester_id AND status IN ('open','cancelled'));

DROP POLICY IF EXISTS "taker updates taken request" ON public.website_requests;

CREATE POLICY "taker updates taken request" ON public.website_requests FOR UPDATE TO authenticated
USING (auth.uid() = taken_by AND status = 'taken')
WITH CHECK (auth.uid() = taken_by AND status IN ('taken','completed'));

DROP POLICY IF EXISTS "admin manages requests" ON public.website_requests;

CREATE POLICY "admin manages requests" ON public.website_requests FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.claim_website_request(request_id UUID, claimer_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed INTEGER;
BEGIN
  IF claimer_id IS NULL OR auth.uid() IS DISTINCT FROM claimer_id THEN
    RAISE EXCEPTION 'Unauthorized request claim';
  END IF;

  UPDATE public.website_requests
  SET status = 'taken', taken_by = claimer_id, taken_at = now(), updated_at = now()
  WHERE id = request_id
    AND status = 'open'
    AND taken_by IS NULL
    AND requester_id <> claimer_id;

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_website_request(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_website_request(request_id UUID, actor_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed INTEGER;
BEGIN
  IF actor_id IS NULL OR auth.uid() IS DISTINCT FROM actor_id THEN
    RAISE EXCEPTION 'Unauthorized request completion';
  END IF;

  UPDATE public.website_requests
  SET status = 'completed', updated_at = now()
  WHERE id = request_id
    AND status = 'taken'
    AND (requester_id = actor_id OR taken_by = actor_id);

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_website_request(UUID, UUID) TO authenticated;

/* -------------------------------------------------------------------------- */
/* Payout integrity                                                            */
/* -------------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION public.enforce_payout_method_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.method_id IS NULL THEN
    RAISE EXCEPTION 'A payout method is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.payout_methods pm
    WHERE pm.id = NEW.method_id AND pm.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Payout method does not belong to this seller';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payout_requests_enforce_method_owner ON public.payout_requests;
CREATE TRIGGER payout_requests_enforce_method_owner
BEFORE INSERT OR UPDATE OF method_id, user_id ON public.payout_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_payout_method_owner();
REVOKE ALL ON FUNCTION public.enforce_payout_method_owner() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.payout_requests
  ADD COLUMN IF NOT EXISTS admin_note TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.finalize_payout_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('paid','rejected') AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.processed_at := COALESCE(NEW.processed_at, now());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payout_requests_finalize ON public.payout_requests;
CREATE TRIGGER payout_requests_finalize
BEFORE UPDATE ON public.payout_requests
FOR EACH ROW EXECUTE FUNCTION public.finalize_payout_request();
REVOKE ALL ON FUNCTION public.finalize_payout_request() FROM PUBLIC, anon, authenticated;

/* -------------------------------------------------------------------------- */
/* Reviews: seller replies and authors cannot move ownership                   */
/* -------------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION public.protect_review_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.listing_id IS DISTINCT FROM OLD.listing_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Review ownership cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reviews_protect_identity ON public.reviews;
CREATE TRIGGER reviews_protect_identity
BEFORE UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.protect_review_identity();
REVOKE ALL ON FUNCTION public.protect_review_identity() FROM PUBLIC, anon, authenticated;

/* -------------------------------------------------------------------------- */
/* Refund/dispute workflow (payment provider is intentionally not called)     */
/* -------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','approved','rejected','resolved')),
  admin_note TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS refund_requests_status_idx ON public.refund_requests(status, created_at DESC);
GRANT SELECT, INSERT ON public.refund_requests TO authenticated;
GRANT ALL ON public.refund_requests TO service_role;
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "buyers read own refunds" ON public.refund_requests;
DROP POLICY IF EXISTS "buyers read own refunds" ON public.refund_requests;
CREATE POLICY "buyers read own refunds" ON public.refund_requests FOR SELECT TO authenticated
USING (auth.uid() = buyer_id OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "buyers create own refunds" ON public.refund_requests;
DROP POLICY IF EXISTS "buyers create own refunds" ON public.refund_requests;
CREATE POLICY "buyers create own refunds" ON public.refund_requests FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = buyer_id
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND o.buyer_id = auth.uid() AND o.status = 'completed'
  )
);
DROP POLICY IF EXISTS "admin updates refunds" ON public.refund_requests;
DROP POLICY IF EXISTS "admin updates refunds" ON public.refund_requests;
CREATE POLICY "admin updates refunds" ON public.refund_requests FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS refund_requests_updated_at ON public.refund_requests;
CREATE TRIGGER refund_requests_updated_at
BEFORE UPDATE ON public.refund_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

/* -------------------------------------------------------------------------- */
/* Admin audit log                                                             */
/* -------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON public.admin_audit_log(target_type, target_id);
GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read audit log" ON public.admin_audit_log;
CREATE POLICY "admins read audit log" ON public.admin_audit_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.write_admin_audit(
  p_admin_id UUID,
  p_action TEXT,
  p_target_type TEXT,
  p_target_id UUID,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  INSERT INTO public.admin_audit_log(admin_id, action, target_type, target_id, metadata)
  VALUES (p_admin_id, p_action, p_target_type, p_target_id, COALESCE(p_metadata, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.write_admin_audit(UUID,TEXT,TEXT,UUID,JSONB) FROM PUBLIC, anon, authenticated;

/* -------------------------------------------------------------------------- */
/* Newsletter backend                                                         */
/* -------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','unsubscribed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_idx ON public.newsletter_subscribers (LOWER(email));
GRANT INSERT, SELECT ON public.newsletter_subscribers TO anon, authenticated;
GRANT ALL ON public.newsletter_subscribers TO service_role;
ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "newsletter insert" ON public.newsletter_subscribers;
DROP POLICY IF EXISTS "newsletter insert" ON public.newsletter_subscribers;
CREATE POLICY "newsletter insert" ON public.newsletter_subscribers FOR INSERT TO anon, authenticated
WITH CHECK (length(trim(email)) BETWEEN 5 AND 320);
DROP POLICY IF EXISTS "newsletter own read" ON public.newsletter_subscribers;
DROP POLICY IF EXISTS "newsletter own read" ON public.newsletter_subscribers;
CREATE POLICY "newsletter own read" ON public.newsletter_subscribers FOR SELECT TO authenticated
USING (false);
DROP TRIGGER IF EXISTS newsletter_updated_at ON public.newsletter_subscribers;
CREATE TRIGGER newsletter_updated_at BEFORE UPDATE ON public.newsletter_subscribers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

/* -------------------------------------------------------------------------- */
/* Product/file validation                                                     */
/* -------------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION public.validate_listing_assets()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE ext TEXT;
BEGIN
  IF NEW.file_size IS NOT NULL AND NEW.file_size > 209715200 THEN
    RAISE EXCEPTION 'Product file exceeds the 200 MB limit';
  END IF;
  IF NEW.file_path IS NOT NULL THEN
    ext := lower(split_part(NEW.file_path, '.', array_length(string_to_array(NEW.file_path, '.'), 1)));
    IF ext NOT IN ('zip','rar','7z','tar','gz','tgz','dmg','exe','msi','apk','ipa') THEN
      RAISE EXCEPTION 'Unsupported product archive/file type';
    END IF;
  END IF;
  IF NEW.docs_url IS NOT NULL AND NEW.docs_url <> '' AND NOT NEW.docs_url ~* '^https?://[^\s]+$' THEN
    RAISE EXCEPTION 'docs_url must be a valid http(s) URL';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS listings_validate_assets ON public.listings;
CREATE TRIGGER listings_validate_assets
BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.validate_listing_assets();
REVOKE ALL ON FUNCTION public.validate_listing_assets() FROM PUBLIC, anon, authenticated;

/* -------------------------------------------------------------------------- */
/* Initial admin bootstrap for the requested owner account                    */
/* -------------------------------------------------------------------------- */
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(email) = lower('nebulasoftwareplat@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;

/* Public request board intentionally excludes contact details. */
DROP VIEW IF EXISTS public.website_requests_public;
CREATE VIEW public.website_requests_public AS
SELECT id, requester_id, title, description, budget, currency, status, taken_by, taken_at,
       created_at, updated_at, tier, photos
FROM public.website_requests;
GRANT SELECT ON public.website_requests_public TO anon, authenticated;

DROP POLICY IF EXISTS "Authenticated can read request photos" ON storage.objects;
DROP POLICY IF EXISTS "Request participants read request photos" ON storage.objects;
CREATE POLICY "Request participants read request photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'request-photos'
  AND EXISTS (
    SELECT 1
    FROM public.website_requests wr
    WHERE wr.photos @> ARRAY[name]::text[]
      AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

/* Ensure the owner account receives admin on future sign-up too. */
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF meta_username IS NOT NULL AND meta_username !~ '^[A-Za-z0-9_]{3,20}$' THEN
    meta_username := NULL;
  END IF;

  INSERT INTO public.profiles (id, email, display_name, username)
  VALUES (NEW.id, NEW.email, meta_display, meta_username)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  IF lower(COALESCE(NEW.email, '')) = lower('nebulasoftwareplat@gmail.com') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, meta_display)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

/* Prevent forged product-file ownership and spoofed analytics identities. */
CREATE OR REPLACE FUNCTION public.validate_listing_assets()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE ext TEXT;
DECLARE owner_folder TEXT;
BEGIN
  IF NEW.file_size IS NOT NULL AND NEW.file_size > 209715200 THEN
    RAISE EXCEPTION 'Product file exceeds the 200 MB limit';
  END IF;
  IF NEW.file_path IS NOT NULL THEN
    owner_folder := split_part(NEW.file_path, '/', 1);
    IF owner_folder IS DISTINCT FROM NEW.seller_id::text THEN
      RAISE EXCEPTION 'Product file must belong to the seller upload folder';
    END IF;
    ext := lower(split_part(NEW.file_path, '.', array_length(string_to_array(NEW.file_path, '.'), 1)));
    IF ext NOT IN ('zip','rar','7z','tar','gz','tgz','dmg','exe','msi','apk','ipa') THEN
      RAISE EXCEPTION 'Unsupported product archive/file type';
    END IF;
  END IF;
  IF NEW.docs_url IS NOT NULL AND NEW.docs_url <> '' AND NOT NEW.docs_url ~* '^https?://[^\s]+$' THEN
    RAISE EXCEPTION 'docs_url must be a valid http(s) URL';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_listing_view_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.viewer_id IS NOT NULL AND NEW.viewer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Invalid viewer identity';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS listing_views_identity ON public.listing_views;
CREATE TRIGGER listing_views_identity
BEFORE INSERT ON public.listing_views
FOR EACH ROW EXECUTE FUNCTION public.validate_listing_view_identity();
REVOKE ALL ON FUNCTION public.validate_listing_view_identity() FROM PUBLIC, anon, authenticated;

-- ===== 20260926090000_global_marketplace_suite.sql =====
-- VELORA Global Marketplace Suite
-- Additive only: preserves existing marketplace data and features.

/* Product monetization ----------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_variants_listing_idx ON public.product_variants(listing_id, active, sort_order);
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.product_variants TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;
DROP POLICY IF EXISTS "variants public read" ON public.product_variants;
DROP POLICY IF EXISTS "variants public read" ON public.product_variants;
CREATE POLICY "variants public read" ON public.product_variants FOR SELECT USING (active OR auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "seller manages variants" ON public.product_variants;
DROP POLICY IF EXISTS "seller manages variants" ON public.product_variants;
CREATE POLICY "seller manages variants" ON public.product_variants FOR ALL TO authenticated USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin')) WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
  currency TEXT,
  min_order_amount NUMERIC(12,2) CHECK (min_order_amount IS NULL OR min_order_amount >= 0),
  max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redeemed_count INTEGER NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(seller_id, code)
);
CREATE INDEX IF NOT EXISTS coupons_code_idx ON public.coupons(lower(code));
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;
DROP POLICY IF EXISTS "coupon owner manages" ON public.coupons;
DROP POLICY IF EXISTS "coupon owner manages" ON public.coupons;
CREATE POLICY "coupon owner manages" ON public.coupons FOR ALL TO authenticated USING (seller_id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (seller_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "active coupons readable" ON public.coupons;
DROP POLICY IF EXISTS "active coupons readable" ON public.coupons;
CREATE POLICY "active coupons readable" ON public.coupons FOR SELECT TO anon, authenticated USING (active AND (starts_at IS NULL OR starts_at <= now()) AND (expires_at IS NULL OR expires_at > now()));

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(coupon_id, buyer_id, order_id)
);
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.coupon_redemptions TO authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;
DROP POLICY IF EXISTS "buyers own coupon redemptions" ON public.coupon_redemptions;
DROP POLICY IF EXISTS "buyers own coupon redemptions" ON public.coupon_redemptions;
CREATE POLICY "buyers own coupon redemptions" ON public.coupon_redemptions FOR SELECT TO authenticated USING (buyer_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.gift_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  initial_amount NUMERIC(12,2) NOT NULL CHECK (initial_amount > 0),
  remaining_amount NUMERIC(12,2) NOT NULL CHECK (remaining_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  buyer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_email TEXT,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.gift_cards TO authenticated;
GRANT ALL ON public.gift_cards TO service_role;
DROP POLICY IF EXISTS "gift card owner read" ON public.gift_cards;
DROP POLICY IF EXISTS "gift card owner read" ON public.gift_cards;
CREATE POLICY "gift card owner read" ON public.gift_cards FOR SELECT TO authenticated USING (buyer_id = auth.uid() OR lower(recipient_email) = lower((SELECT email FROM auth.users WHERE id = auth.uid())) OR public.has_role(auth.uid(),'admin'));

/* Licensing, updates, product Q&A ----------------------------------------- */
CREATE TABLE IF NOT EXISTS public.license_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  license_key TEXT NOT NULL UNIQUE,
  seats INTEGER NOT NULL DEFAULT 1 CHECK (seats > 0),
  used_seats INTEGER NOT NULL DEFAULT 0 CHECK (used_seats >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS license_keys_buyer_idx ON public.license_keys(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS license_keys_listing_idx ON public.license_keys(listing_id);
ALTER TABLE public.license_keys ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.license_keys TO authenticated;
GRANT ALL ON public.license_keys TO service_role;
DROP POLICY IF EXISTS "buyer reads licenses" ON public.license_keys;
DROP POLICY IF EXISTS "buyer reads licenses" ON public.license_keys;
CREATE POLICY "buyer reads licenses" ON public.license_keys FOR SELECT TO authenticated USING (buyer_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id));

CREATE TABLE IF NOT EXISTS public.product_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  changelog TEXT NOT NULL,
  download_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.product_updates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_updates TO authenticated;
GRANT ALL ON public.product_updates TO service_role;
DROP POLICY IF EXISTS "product updates readable" ON public.product_updates;
DROP POLICY IF EXISTS "product updates readable" ON public.product_updates;
CREATE POLICY "product updates readable" ON public.product_updates FOR SELECT USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(), 'admin') OR EXISTS (SELECT 1 FROM public.orders o WHERE o.listing_id = product_updates.listing_id AND o.buyer_id = auth.uid() AND o.status = 'completed'));
DROP POLICY IF EXISTS "seller manages updates" ON public.product_updates;
DROP POLICY IF EXISTS "seller manages updates" ON public.product_updates;
CREATE POLICY "seller manages updates" ON public.product_updates FOR ALL TO authenticated USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin')) WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.product_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT,
  answered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.product_questions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.product_questions TO authenticated;
GRANT ALL ON public.product_questions TO service_role;
DROP POLICY IF EXISTS "questions readable" ON public.product_questions;
DROP POLICY IF EXISTS "questions readable" ON public.product_questions;
CREATE POLICY "questions readable" ON public.product_questions FOR SELECT USING (true);
DROP POLICY IF EXISTS "buyers ask questions" ON public.product_questions;
DROP POLICY IF EXISTS "buyers ask questions" ON public.product_questions;
CREATE POLICY "buyers ask questions" ON public.product_questions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "seller answers questions" ON public.product_questions;
DROP POLICY IF EXISTS "seller answers questions" ON public.product_questions;
CREATE POLICY "seller answers questions" ON public.product_questions FOR UPDATE TO authenticated USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR auth.uid() = user_id OR public.has_role(auth.uid(),'admin')) WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

/* Messaging and support ---------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
  buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(listing_id, buyer_id, seller_id)
);
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON public.messages(conversation_id, created_at);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.conversations, public.messages TO service_role;
DROP POLICY IF EXISTS "conversation members" ON public.conversations;
DROP POLICY IF EXISTS "conversation members" ON public.conversations;
CREATE POLICY "conversation members" ON public.conversations FOR ALL TO authenticated USING (auth.uid() IN (buyer_id,seller_id) OR public.has_role(auth.uid(),'admin')) WITH CHECK (auth.uid() IN (buyer_id,seller_id) OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "message members" ON public.messages;
DROP POLICY IF EXISTS "message members" ON public.messages;
CREATE POLICY "message members" ON public.messages FOR ALL TO authenticated USING (sender_id = auth.uid() OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND auth.uid() IN (c.buyer_id,c.seller_id)) OR public.has_role(auth.uid(),'admin')) WITH CHECK (sender_id = auth.uid() OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND auth.uid() IN (c.buyer_id,c.seller_id)) OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO authenticated;
GRANT SELECT, INSERT ON public.support_messages TO authenticated;
GRANT ALL ON public.support_tickets, public.support_messages TO service_role;
DROP POLICY IF EXISTS "ticket participants" ON public.support_tickets;
DROP POLICY IF EXISTS "ticket participants" ON public.support_tickets;
CREATE POLICY "ticket participants" ON public.support_tickets FOR ALL TO authenticated USING (user_id = auth.uid() OR assigned_to = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (user_id = auth.uid() OR assigned_to = auth.uid() OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "ticket messages participants" ON public.support_messages;
DROP POLICY IF EXISTS "ticket messages participants" ON public.support_messages;
CREATE POLICY "ticket messages participants" ON public.support_messages FOR ALL TO authenticated USING (sender_id = auth.uid() OR EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND (t.user_id = auth.uid() OR t.assigned_to = auth.uid() OR public.has_role(auth.uid(),'admin')))) WITH CHECK (sender_id = auth.uid() OR EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND (t.user_id = auth.uid() OR t.assigned_to = auth.uid() OR public.has_role(auth.uid(),'admin'))));

/* Seller trust, affiliates, referrals ------------------------------------- */
CREATE TABLE IF NOT EXISTS public.seller_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','pending','verified','rejected','suspended')),
  legal_name TEXT,
  country_code TEXT,
  tax_id TEXT,
  website TEXT,
  notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.seller_verifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.seller_verifications TO authenticated;
GRANT ALL ON public.seller_verifications TO service_role;
DROP POLICY IF EXISTS "seller verification owner" ON public.seller_verifications;
DROP POLICY IF EXISTS "seller verification owner" ON public.seller_verifications;
CREATE POLICY "seller verification owner" ON public.seller_verifications FOR ALL TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.affiliate_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (commission_percent >= 0 AND commission_percent <= 100),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(seller_id)
);
CREATE TABLE IF NOT EXISTS public.affiliate_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES public.affiliate_programs(id) ON DELETE CASCADE,
  affiliate_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  click_id TEXT,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.affiliate_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_referrals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.affiliate_programs TO authenticated;
GRANT SELECT, INSERT ON public.affiliate_referrals TO authenticated;
GRANT ALL ON public.affiliate_programs, public.affiliate_referrals TO service_role;
DROP POLICY IF EXISTS "affiliate program owner" ON public.affiliate_programs;
DROP POLICY IF EXISTS "affiliate program owner" ON public.affiliate_programs;
CREATE POLICY "affiliate program owner" ON public.affiliate_programs FOR ALL TO authenticated USING (seller_id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (seller_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "affiliate referral participants" ON public.affiliate_referrals;
DROP POLICY IF EXISTS "affiliate referral participants" ON public.affiliate_referrals;
CREATE POLICY "affiliate referral participants" ON public.affiliate_referrals FOR SELECT TO authenticated USING (affiliate_id = auth.uid() OR program_id IN (SELECT id FROM public.affiliate_programs WHERE seller_id = auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  reward_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','qualified','paid','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
DROP POLICY IF EXISTS "referral participants" ON public.referrals;
DROP POLICY IF EXISTS "referral participants" ON public.referrals;
CREATE POLICY "referral participants" ON public.referrals FOR SELECT TO authenticated USING (referrer_id = auth.uid() OR referred_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

/* Analytics, API and lifecycle automation -------------------------------- */
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  session_id TEXT,
  path TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON public.analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_listing_idx ON public.analytics_events(listing_id, created_at DESC);
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.analytics_events TO anon, authenticated;
GRANT SELECT ON public.analytics_events TO authenticated;
GRANT ALL ON public.analytics_events TO service_role;
DROP POLICY IF EXISTS "analytics insert" ON public.analytics_events;
DROP POLICY IF EXISTS "analytics insert" ON public.analytics_events;
CREATE POLICY "analytics insert" ON public.analytics_events FOR INSERT TO anon, authenticated WITH CHECK (user_id IS NULL OR user_id = auth.uid());
DROP POLICY IF EXISTS "analytics seller read" ON public.analytics_events;
DROP POLICY IF EXISTS "analytics seller read" ON public.analytics_events;
CREATE POLICY "analytics seller read" ON public.analytics_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR user_id = auth.uid() OR listing_id IN (SELECT id FROM public.listings WHERE seller_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
DROP POLICY IF EXISTS "own api keys" ON public.api_keys;
DROP POLICY IF EXISTS "own api keys" ON public.api_keys;
CREATE POLICY "own api keys" ON public.api_keys FOR ALL TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  provider TEXT,
  provider_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','paused','cancelled','past_due','expired')),
  currency TEXT NOT NULL DEFAULT 'USD',
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  interval TEXT NOT NULL DEFAULT 'month' CHECK (interval IN ('week','month','year')),
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_subscription_id)
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
DROP POLICY IF EXISTS "subscription owner" ON public.subscriptions;
DROP POLICY IF EXISTS "subscription owner" ON public.subscriptions;
CREATE POLICY "subscription owner" ON public.subscriptions FOR ALL TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  product_updates BOOLEAN NOT NULL DEFAULT true,
  order_emails BOOLEAN NOT NULL DEFAULT true,
  marketing_emails BOOLEAN NOT NULL DEFAULT false,
  messages BOOLEAN NOT NULL DEFAULT true,
  security_alerts BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
DROP POLICY IF EXISTS "own notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "own notification preferences" ON public.notification_preferences;
CREATE POLICY "own notification preferences" ON public.notification_preferences FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.tax_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  country_code TEXT,
  region_code TEXT,
  tax_number TEXT,
  business_name TEXT,
  business_type TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tax_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.tax_profiles TO authenticated;
GRANT ALL ON public.tax_profiles TO service_role;
DROP POLICY IF EXISTS "own tax profile" ON public.tax_profiles;
DROP POLICY IF EXISTS "own tax profile" ON public.tax_profiles;
CREATE POLICY "own tax profile" ON public.tax_profiles FOR ALL TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  cover_url TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.collection_items (
  collection_id UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(collection_id, listing_id)
);
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collections, public.collection_items TO authenticated;
GRANT SELECT ON public.collections, public.collection_items TO anon;
GRANT ALL ON public.collections, public.collection_items TO service_role;
DROP POLICY IF EXISTS "public collections readable" ON public.collections;
DROP POLICY IF EXISTS "public collections readable" ON public.collections;
CREATE POLICY "public collections readable" ON public.collections FOR SELECT USING (visibility = 'public' OR owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "collection owner manages" ON public.collections;
DROP POLICY IF EXISTS "collection owner manages" ON public.collections;
CREATE POLICY "collection owner manages" ON public.collections FOR ALL TO authenticated USING (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "collection items readable" ON public.collection_items;
DROP POLICY IF EXISTS "collection items readable" ON public.collection_items;
CREATE POLICY "collection items readable" ON public.collection_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.collections c WHERE c.id = collection_id AND (c.visibility='public' OR c.owner_id=auth.uid() OR public.has_role(auth.uid(),'admin'))));
DROP POLICY IF EXISTS "collection items owner" ON public.collection_items;
DROP POLICY IF EXISTS "collection items owner" ON public.collection_items;
CREATE POLICY "collection items owner" ON public.collection_items FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.collections c WHERE c.id = collection_id AND (c.owner_id=auth.uid() OR public.has_role(auth.uid(),'admin')))) WITH CHECK (EXISTS (SELECT 1 FROM public.collections c WHERE c.id = collection_id AND (c.owner_id=auth.uid() OR public.has_role(auth.uid(),'admin'))));

/* Better timestamp maintenance -------------------------------------------- */
CREATE OR REPLACE FUNCTION public.touch_global_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['seller_verifications','support_tickets','notification_preferences','tax_profiles'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_global_updated_at()', t, t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.touch_global_updated_at() FROM PUBLIC, anon, authenticated;

-- ===== 20260926100000_product_studio_admin.sql =====
-- VELORA Product Studio + Admin 2.0
-- Additive schema. Existing listings and commerce data are preserved.

CREATE TABLE IF NOT EXISTS public.listing_product_details (
  listing_id UUID PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL DEFAULT 'software',
  short_description TEXT,
  subcategory TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  included_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_audience TEXT,
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  languages JSONB NOT NULL DEFAULT '[]'::jsonb,
  requirements TEXT,
  tech_stack JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_formats JSONB NOT NULL DEFAULT '[]'::jsonb,
  version TEXT,
  release_date DATE,
  last_updated DATE,
  pricing_model TEXT NOT NULL DEFAULT 'one_time',
  trial_days INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  pay_what_you_want BOOLEAN NOT NULL DEFAULT false,
  minimum_price NUMERIC(12,2) CHECK (minimum_price IS NULL OR minimum_price >= 0),
  license_type TEXT NOT NULL DEFAULT 'standard',
  license_seats INTEGER NOT NULL DEFAULT 1 CHECK (license_seats > 0),
  activation_limit INTEGER CHECK (activation_limit IS NULL OR activation_limit > 0),
  license_duration_days INTEGER CHECK (license_duration_days IS NULL OR license_duration_days > 0),
  tax_category TEXT,
  support_url TEXT,
  documentation_url TEXT,
  seo_title TEXT,
  seo_description TEXT,
  seo_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  changelog TEXT,
  ai_used BOOLEAN NOT NULL DEFAULT false,
  ai_details TEXT,
  rights_confirmed BOOLEAN NOT NULL DEFAULT false,
  assets_confirmed BOOLEAN NOT NULL DEFAULT false,
  legal_confirmed BOOLEAN NOT NULL DEFAULT false,
  quality_score INTEGER NOT NULL DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.listing_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('cover','screenshot','gallery','video','gif')),
  storage_path TEXT,
  external_url TEXT,
  title TEXT,
  alt_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_media_listing_idx ON public.listing_media(listing_id, sort_order);

CREATE TABLE IF NOT EXISTS public.listing_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  asset_kind TEXT NOT NULL DEFAULT 'download',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  checksum_sha256 TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_assets_listing_idx ON public.listing_assets(listing_id, sort_order);

CREATE TABLE IF NOT EXISTS public.listing_faq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.listing_product_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_faq ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.listing_product_details, public.listing_media, public.listing_faq TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_product_details, public.listing_media, public.listing_assets, public.listing_faq TO authenticated;
GRANT ALL ON public.listing_product_details, public.listing_media, public.listing_assets, public.listing_faq TO service_role;

DROP POLICY IF EXISTS "product details public read" ON public.listing_product_details;
DROP POLICY IF EXISTS "product details public read" ON public.listing_product_details;
CREATE POLICY "product details public read" ON public.listing_product_details FOR SELECT USING (true);
DROP POLICY IF EXISTS "product details seller manage" ON public.listing_product_details;
DROP POLICY IF EXISTS "product details seller manage" ON public.listing_product_details;
CREATE POLICY "product details seller manage" ON public.listing_product_details FOR ALL TO authenticated
  USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "listing media public read" ON public.listing_media;
DROP POLICY IF EXISTS "listing media public read" ON public.listing_media;
CREATE POLICY "listing media public read" ON public.listing_media FOR SELECT USING (true);
DROP POLICY IF EXISTS "listing media seller manage" ON public.listing_media;
DROP POLICY IF EXISTS "listing media seller manage" ON public.listing_media;
CREATE POLICY "listing media seller manage" ON public.listing_media FOR ALL TO authenticated
  USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "listing assets seller manage" ON public.listing_assets;
DROP POLICY IF EXISTS "listing assets seller manage" ON public.listing_assets;
CREATE POLICY "listing assets seller manage" ON public.listing_assets FOR ALL TO authenticated
  USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "listing faq public read" ON public.listing_faq;
DROP POLICY IF EXISTS "listing faq public read" ON public.listing_faq;
CREATE POLICY "listing faq public read" ON public.listing_faq FOR SELECT USING (true);
DROP POLICY IF EXISTS "listing faq seller manage" ON public.listing_faq;
DROP POLICY IF EXISTS "listing faq seller manage" ON public.listing_faq;
CREATE POLICY "listing faq seller manage" ON public.listing_faq FOR ALL TO authenticated
  USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

DROP TRIGGER IF EXISTS listing_product_details_touch ON public.listing_product_details;
CREATE TRIGGER listing_product_details_touch BEFORE UPDATE ON public.listing_product_details
FOR EACH ROW EXECUTE FUNCTION public.touch_global_updated_at();

-- Admin can see operational tables through existing service-side queries. Add a lightweight queue table for explicit moderation actions.
CREATE TABLE IF NOT EXISTS public.admin_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL CHECK (task_type IN ('moderation','verification','support','refund','payout','report','security')),
  target_id UUID,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','dismissed')),
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_tasks_queue_idx ON public.admin_tasks(status, priority, created_at DESC);
ALTER TABLE public.admin_tasks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_tasks TO authenticated;
GRANT ALL ON public.admin_tasks TO service_role;
DROP POLICY IF EXISTS "admin tasks admin only" ON public.admin_tasks;
DROP POLICY IF EXISTS "admin tasks admin only" ON public.admin_tasks;
CREATE POLICY "admin tasks admin only" ON public.admin_tasks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP TRIGGER IF EXISTS admin_tasks_touch ON public.admin_tasks;
CREATE TRIGGER admin_tasks_touch BEFORE UPDATE ON public.admin_tasks
FOR EACH ROW EXECUTE FUNCTION public.touch_global_updated_at();

CREATE TABLE IF NOT EXISTS public.admin_user_controls (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','restricted','suspended','banned')),
  note TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_user_controls ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.admin_user_controls TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.admin_user_controls TO authenticated;
GRANT ALL ON public.admin_user_controls TO service_role;
DROP POLICY IF EXISTS "admin user controls admin only" ON public.admin_user_controls;
DROP POLICY IF EXISTS "admin user controls admin only" ON public.admin_user_controls;
CREATE POLICY "admin user controls admin only" ON public.admin_user_controls FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP TRIGGER IF EXISTS admin_user_controls_touch ON public.admin_user_controls;
CREATE TRIGGER admin_user_controls_touch BEFORE UPDATE ON public.admin_user_controls
FOR EACH ROW EXECUTE FUNCTION public.touch_global_updated_at();

CREATE TABLE IF NOT EXISTS public.seller_verification_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id UUID NOT NULL REFERENCES public.seller_verifications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.seller_verification_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_verification_documents TO authenticated;
GRANT ALL ON public.seller_verification_documents TO service_role;
DROP POLICY IF EXISTS "verification docs owner admin" ON public.seller_verification_documents;
DROP POLICY IF EXISTS "verification docs owner admin" ON public.seller_verification_documents;
CREATE POLICY "verification docs owner admin" ON public.seller_verification_documents FOR ALL TO authenticated
  USING (verification_id IN (SELECT id FROM public.seller_verifications WHERE user_id = auth.uid()) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (verification_id IN (SELECT id FROM public.seller_verifications WHERE user_id = auth.uid()) OR public.has_role(auth.uid(),'admin'));

-- ===== 20260926123000_marketplace_completion.sql =====
-- VELORA Marketplace completion + production operations layer.
-- Additive, idempotent, and safe to apply after the existing suite migrations.

CREATE TABLE IF NOT EXISTS public.storefront_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  store_name TEXT,
  tagline TEXT,
  bio TEXT,
  logo_url TEXT,
  banner_url TEXT,
  accent TEXT,
  website_url TEXT,
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  featured_listing_ids UUID[] NOT NULL DEFAULT '{}',
  is_public BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.storefront_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.storefront_settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.storefront_settings TO authenticated;
GRANT ALL ON public.storefront_settings TO service_role;
DROP POLICY IF EXISTS "public storefront read" ON public.storefront_settings;
DROP POLICY IF EXISTS "public storefront read" ON public.storefront_settings;
CREATE POLICY "public storefront read" ON public.storefront_settings FOR SELECT USING (is_public OR auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "owner manages storefront" ON public.storefront_settings;
DROP POLICY IF EXISTS "owner manages storefront" ON public.storefront_settings;
CREATE POLICY "owner manages storefront" ON public.storefront_settings FOR ALL TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin')) WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.gift_card_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id UUID NOT NULL REFERENCES public.gift_cards(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('issue','redeem','refund','adjustment','expire')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gift_card_transactions_card_idx ON public.gift_card_transactions(gift_card_id, created_at DESC);
ALTER TABLE public.gift_card_transactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.gift_card_transactions TO authenticated;
GRANT ALL ON public.gift_card_transactions TO service_role;
DROP POLICY IF EXISTS "gift card transaction owner read" ON public.gift_card_transactions;
DROP POLICY IF EXISTS "gift card transaction owner read" ON public.gift_card_transactions;
CREATE POLICY "gift card transaction owner read" ON public.gift_card_transactions FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR EXISTS (
    SELECT 1 FROM public.gift_cards g WHERE g.id = gift_card_id AND (g.buyer_id = auth.uid() OR lower(g.recipient_email) = lower((SELECT email FROM auth.users WHERE id = auth.uid())))
  )
);

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  payload JSONB,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE(provider, event_id)
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_status_idx ON public.webhook_deliveries(provider, status, received_at DESC);
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_deliveries FROM anon, authenticated;
GRANT ALL ON public.webhook_deliveries TO service_role;

CREATE TABLE IF NOT EXISTS public.malware_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES public.listings(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES public.listing_assets(id) ON DELETE CASCADE,
  scanner TEXT NOT NULL,
  scanner_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','clean','infected','error','skipped')),
  signature TEXT,
  findings JSONB,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(asset_id, scanner)
);
CREATE INDEX IF NOT EXISTS malware_scans_listing_idx ON public.malware_scans(listing_id, scanned_at DESC);
ALTER TABLE public.malware_scans ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.malware_scans TO authenticated;
GRANT ALL ON public.malware_scans TO service_role;
DROP POLICY IF EXISTS "seller reads own scan status" ON public.malware_scans;
DROP POLICY IF EXISTS "seller reads own scan status" ON public.malware_scans;
CREATE POLICY "seller reads own scan status" ON public.malware_scans FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id)
);

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  template_key TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  provider_message_id TEXT,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_outbox_queue_idx ON public.email_outbox(status, available_at, created_at);
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outbox FROM anon, authenticated;
GRANT ALL ON public.email_outbox TO service_role;

CREATE TABLE IF NOT EXISTS public.listing_moderation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_moderation_events_listing_idx ON public.listing_moderation_events(listing_id, created_at DESC);
ALTER TABLE public.listing_moderation_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.listing_moderation_events TO authenticated;
GRANT ALL ON public.listing_moderation_events TO service_role;
DROP POLICY IF EXISTS "seller reads moderation history" ON public.listing_moderation_events;
DROP POLICY IF EXISTS "seller reads moderation history" ON public.listing_moderation_events;
CREATE POLICY "seller reads moderation history" ON public.listing_moderation_events FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id)
);

CREATE OR REPLACE FUNCTION public.touch_storefront_settings()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS storefront_settings_touch ON public.storefront_settings;
CREATE TRIGGER storefront_settings_touch BEFORE UPDATE ON public.storefront_settings FOR EACH ROW EXECUTE FUNCTION public.touch_storefront_settings();
REVOKE ALL ON FUNCTION public.touch_storefront_settings() FROM PUBLIC, anon, authenticated;

-- Keep product listing discovery fast as the catalogue grows.
CREATE INDEX IF NOT EXISTS listings_active_created_idx ON public.listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS listings_active_kind_idx ON public.listings(status, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS listings_active_category_idx ON public.listings(status, category, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_user_created_idx ON public.analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_listing_created_idx ON public.analytics_events(listing_id, created_at DESC);

-- Enforce the private delivery bucket if it exists; do not mutate storage metadata here.
-- Storage policies must remain managed through Supabase Storage APIs.

ALTER TABLE public.payout_methods ADD COLUMN IF NOT EXISTS provider_contact_id TEXT;
ALTER TABLE public.payout_methods ADD COLUMN IF NOT EXISTS provider_fund_account_id TEXT;
CREATE INDEX IF NOT EXISTS payout_methods_provider_fund_idx ON public.payout_methods(provider_fund_account_id) WHERE provider_fund_account_id IS NOT NULL;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_variant_idx ON public.orders(variant_id) WHERE variant_id IS NOT NULL;

-- ===== 20260926140000_platform_fee_and_payment_hardening.sql =====
-- VELORA production payment hardening.
-- Platform commission: 15% of the final sale amount.
-- Also fixes variant/tier pricing so the DB cannot silently charge/credit using
-- the base listing price when a buyer purchased a variant.

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
  FROM public.listings
  WHERE id = NEW.listing_id;

  IF l_price IS NULL THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;
  IF l_status <> 'active' THEN
    RAISE EXCEPTION 'Listing is not available for purchase';
  END IF;

  -- A variant/tier is the authoritative price when supplied.
  IF NEW.variant_id IS NOT NULL THEN
    SELECT price, currency
      INTO l_price, l_currency
    FROM public.product_variants
    WHERE id = NEW.variant_id
      AND listing_id = NEW.listing_id
      AND active = true;

    IF l_price IS NULL THEN
      RAISE EXCEPTION 'Selected product tier is unavailable';
    END IF;

    IF upper(l_currency) <> upper((SELECT currency FROM public.listings WHERE id = NEW.listing_id)) THEN
      RAISE EXCEPTION 'Product tier currency mismatch';
    END IF;
  END IF;

  NEW.amount := l_price;
  NEW.currency := l_currency;
  NEW.seller_id := l_seller;
  fee := ROUND((l_price * 0.15)::numeric, 2);
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

-- Never allow a browser client to forge a completed order. All order creation
-- must come from verified server-side payment/webhook code using service_role.
DROP POLICY IF EXISTS "anyone can create order" ON public.orders;
REVOKE INSERT ON public.orders FROM anon, authenticated;
GRANT INSERT ON public.orders TO service_role;

-- Keep payment IDs unique even under concurrent webhook retries.
CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_payment_unique_idx
  ON public.orders(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_order_unique_idx
  ON public.orders(provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

-- Commission configuration is visible to server/admin tooling without exposing
-- payment secrets. Application code uses the same 15% constant.
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_settings FROM anon, authenticated;
GRANT ALL ON public.platform_settings TO service_role;
INSERT INTO public.platform_settings(key, value)
VALUES ('platform_commission_percent', '15'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- ===== 20260926143000_global_payment_provider.sql =====
-- Global payment provider support.
-- Stripe Checkout is optional; Razorpay remains supported for merchants who use it.
-- No payment secret is stored in the database.
CREATE INDEX IF NOT EXISTS webhook_deliveries_provider_status_idx
  ON public.webhook_deliveries(provider, status, received_at DESC);

-- ===== 20260926145000_listing_moderation_guard.sql =====
-- Marketplace upload/moderation hardening.
-- Sellers may submit products, but cannot self-publish or silently edit an active
-- listing without sending it back through moderation.

CREATE OR REPLACE FUNCTION public.enforce_listing_moderation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asset_count INTEGER;
  detail_count INTEGER;
BEGIN
  -- Service-role server actions are the trusted moderation path.
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'pending';
    ELSIF NEW.status = 'active' THEN
      NEW.status := 'pending';
    END IF;
  END IF;

  -- A trusted publish action still has to satisfy the minimum Product Studio
  -- delivery requirements. This prevents an admin/API bug from publishing an
  -- empty or non-deliverable product.
  IF NEW.status = 'active' THEN
    SELECT count(*) INTO asset_count
    FROM public.listing_assets
    WHERE listing_id = NEW.id;

    SELECT count(*) INTO detail_count
    FROM public.listing_product_details
    WHERE listing_id = NEW.id;

    IF asset_count < 1 OR detail_count < 1 OR NEW.cover_url IS NULL OR length(trim(NEW.cover_url)) < 8 THEN
      RAISE EXCEPTION 'Listing cannot be published until Product Studio details, cover media, and at least one delivery asset exist';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listings_moderation_guard ON public.listings;
CREATE TRIGGER listings_moderation_guard
BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.enforce_listing_moderation_guard();

REVOKE ALL ON FUNCTION public.enforce_listing_moderation_guard() FROM PUBLIC, anon, authenticated;

-- Seller-safe scan queue RPC: clients can request a scan queue without gaining
-- direct INSERT access to the operational malware_scans table.
CREATE OR REPLACE FUNCTION public.queue_listing_scans(p_listing_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  IF NOT (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = p_listing_id) OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Not allowed to queue scans for this listing';
  END IF;

  INSERT INTO public.malware_scans(listing_id, asset_id, scanner, status, findings)
  SELECT a.listing_id, a.id, 'production-adapter', 'queued', jsonb_build_object('source','product-studio-upload')
  FROM public.listing_assets a
  WHERE a.listing_id = p_listing_id
  ON CONFLICT (asset_id, scanner) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.queue_listing_scans(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.queue_listing_scans(UUID) FROM anon;

-- ===== 20260926160000_production_completion.sql =====
-- VELORA Production Completion 2.4
-- Additive hardening for marketplace-grade commerce. Provider secrets stay server-side.

CREATE TABLE IF NOT EXISTS public.seller_payment_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('stripe_connect','razorpay_route')),
  provider_account_id TEXT NOT NULL,
  country_code TEXT,
  onboarding_status TEXT NOT NULL DEFAULT 'pending' CHECK (onboarding_status IN ('pending','restricted','enabled','disabled')),
  charges_enabled BOOLEAN NOT NULL DEFAULT false,
  payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  details_submitted BOOLEAN NOT NULL DEFAULT false,
  requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_account_id),
  UNIQUE(seller_id, provider)
);
ALTER TABLE public.seller_payment_accounts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.seller_payment_accounts TO authenticated;
GRANT ALL ON public.seller_payment_accounts TO service_role;
DROP POLICY IF EXISTS "seller payment account owner" ON public.seller_payment_accounts;
DROP POLICY IF EXISTS "seller payment account owner" ON public.seller_payment_accounts;
CREATE POLICY "seller payment account owner" ON public.seller_payment_accounts
  FOR ALL TO authenticated
  USING (seller_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (seller_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES public.coupons(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(12,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS buyer_country TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_checkout_id TEXT;
CREATE INDEX IF NOT EXISTS orders_buyer_created_idx ON public.orders(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_coupon_idx ON public.orders(coupon_id) WHERE coupon_id IS NOT NULL;

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS provider_customer_id TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS provider_price_id TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS latest_invoice_id TEXT;
CREATE INDEX IF NOT EXISTS subscriptions_user_status_idx ON public.subscriptions(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hits INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_buckets FROM anon, authenticated;
GRANT ALL ON public.rate_limit_buckets TO service_role;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(p_key TEXT, p_limit INTEGER, p_window_seconds INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rate_limit_buckets%ROWTYPE;
BEGIN
  INSERT INTO public.rate_limit_buckets(key, window_started_at, hits, updated_at)
  VALUES (p_key, now(), 1, now())
  ON CONFLICT (key) DO UPDATE SET
    window_started_at = CASE WHEN now() - rate_limit_buckets.window_started_at >= make_interval(secs => p_window_seconds) THEN now() ELSE rate_limit_buckets.window_started_at END,
    hits = CASE WHEN now() - rate_limit_buckets.window_started_at >= make_interval(secs => p_window_seconds) THEN 1 ELSE rate_limit_buckets.hits + 1 END,
    updated_at = now()
  RETURNING * INTO r;
  RETURN r.hits <= p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_coupon(p_code TEXT, p_seller_id UUID, p_amount NUMERIC, p_currency TEXT, p_buyer_id UUID)
RETURNS TABLE(coupon_id UUID, discount_type TEXT, discount_value NUMERIC, discount_amount NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.coupons%ROWTYPE; d NUMERIC;
BEGIN
  SELECT * INTO c FROM public.coupons
  WHERE seller_id = p_seller_id AND lower(code) = lower(trim(p_code)) AND active = true
    AND (starts_at IS NULL OR starts_at <= now()) AND (expires_at IS NULL OR expires_at > now())
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or expired coupon'; END IF;
  IF c.max_redemptions IS NOT NULL AND c.redeemed_count >= c.max_redemptions THEN RAISE EXCEPTION 'Coupon redemption limit reached'; END IF;
  IF c.min_order_amount IS NOT NULL AND p_amount < c.min_order_amount THEN RAISE EXCEPTION 'Order does not meet coupon minimum'; END IF;
  IF c.currency IS NOT NULL AND upper(c.currency) <> upper(p_currency) THEN RAISE EXCEPTION 'Coupon currency mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM public.coupon_redemptions WHERE coupon_id = c.id AND buyer_id = p_buyer_id) THEN RAISE EXCEPTION 'Coupon already used'; END IF;
  d := CASE WHEN c.discount_type = 'percent' THEN round((p_amount * c.discount_value / 100)::numeric, 2) ELSE c.discount_value END;
  d := LEAST(GREATEST(d, 0), p_amount);
  RETURN QUERY SELECT c.id, c.discount_type, c.discount_value, d;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_coupon(TEXT, UUID, NUMERIC, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon(TEXT, UUID, NUMERIC, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_coupon(p_coupon_id UUID, p_buyer_id UUID, p_order_id UUID, p_amount NUMERIC)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.coupon_redemptions(coupon_id,buyer_id,order_id,amount) VALUES(p_coupon_id,p_buyer_id,p_order_id,p_amount)
  ON CONFLICT DO NOTHING;
  UPDATE public.coupons SET redeemed_count = redeemed_count + 1 WHERE id = p_coupon_id;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_coupon(UUID, UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_coupon(UUID, UUID, UUID, NUMERIC) TO service_role;

CREATE OR REPLACE FUNCTION public.redeem_gift_card(p_code TEXT, p_user_id UUID, p_order_id UUID, p_amount NUMERIC, p_currency TEXT)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.gift_cards%ROWTYPE; applied NUMERIC;
BEGIN
  SELECT * INTO g FROM public.gift_cards WHERE lower(code)=lower(trim(p_code)) AND active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid gift card'; END IF;
  IF g.expires_at IS NOT NULL AND g.expires_at <= now() THEN RAISE EXCEPTION 'Gift card expired'; END IF;
  IF upper(g.currency) <> upper(p_currency) THEN RAISE EXCEPTION 'Gift card currency mismatch'; END IF;
  applied := LEAST(g.remaining_amount, p_amount);
  IF applied <= 0 THEN RAISE EXCEPTION 'Gift card has no remaining balance'; END IF;
  UPDATE public.gift_cards SET remaining_amount = remaining_amount - applied, active = (remaining_amount - applied) > 0 WHERE id=g.id;
  INSERT INTO public.gift_card_transactions(gift_card_id,order_id,user_id,transaction_type,amount,currency,note)
  VALUES(g.id,p_order_id,p_user_id,'redeem',applied,g.currency,'Checkout redemption');
  RETURN applied;
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_gift_card(TEXT, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_gift_card(TEXT, UUID, UUID, NUMERIC, TEXT) TO service_role;

-- Seller-owned public media gets a durable public bucket; paid files remain private.
INSERT INTO storage.buckets(id, name, public, file_size_limit)
VALUES ('listing-media', 'listing-media', true, 26214400)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "listing media public read" ON storage.objects;
DROP POLICY IF EXISTS "listing media public read" ON storage.objects;
CREATE POLICY "listing media public read" ON storage.objects FOR SELECT USING (bucket_id='listing-media');
DROP POLICY IF EXISTS "listing media seller upload" ON storage.objects;
DROP POLICY IF EXISTS "listing media seller upload" ON storage.objects;
CREATE POLICY "listing media seller upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='listing-media' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "listing media seller update" ON storage.objects;
DROP POLICY IF EXISTS "listing media seller update" ON storage.objects;
CREATE POLICY "listing media seller update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='listing-media' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id='listing-media' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "listing media seller delete" ON storage.objects;
DROP POLICY IF EXISTS "listing media seller delete" ON storage.objects;
CREATE POLICY "listing media seller delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='listing-media' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Do not expose internal rate-limit records or provider account secrets to clients.
REVOKE ALL ON public.seller_payment_accounts FROM anon;

-- Make the DB authoritative for discounted checkout totals too.
CREATE OR REPLACE FUNCTION public.enforce_order_financials()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l_price NUMERIC; l_currency TEXT; l_seller UUID; l_status TEXT; fee NUMERIC; net NUMERIC;
BEGIN
  SELECT price,currency,seller_id,status INTO l_price,l_currency,l_seller,l_status FROM public.listings WHERE id=NEW.listing_id;
  IF l_price IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF l_status <> 'active' THEN RAISE EXCEPTION 'Listing is not available for purchase'; END IF;
  IF NEW.variant_id IS NOT NULL THEN
    SELECT price,currency INTO l_price,l_currency FROM public.product_variants WHERE id=NEW.variant_id AND listing_id=NEW.listing_id AND active=true;
    IF l_price IS NULL THEN RAISE EXCEPTION 'Selected product tier is unavailable'; END IF;
    IF upper(l_currency) <> upper((SELECT currency FROM public.listings WHERE id=NEW.listing_id)) THEN RAISE EXCEPTION 'Product tier currency mismatch'; END IF;
  END IF;
  NEW.gross_amount := COALESCE(NEW.gross_amount,l_price);
  IF EXISTS (SELECT 1 FROM public.listing_product_details d WHERE d.listing_id=NEW.listing_id AND d.pricing_model='pay_what_you_want' AND d.pay_what_you_want=true) THEN
    IF NEW.gross_amount <= 0 THEN RAISE EXCEPTION 'Invalid pay-what-you-want amount'; END IF;
  ELSIF NEW.gross_amount <> l_price THEN RAISE EXCEPTION 'Gross amount does not match catalog price'; END IF;
  NEW.discount_amount := LEAST(GREATEST(COALESCE(NEW.discount_amount,0),0),NEW.gross_amount);
  NEW.amount := ROUND((NEW.gross_amount - NEW.discount_amount + COALESCE(NEW.tax_amount,0))::numeric,2);
  IF NEW.amount < 0 THEN RAISE EXCEPTION 'Invalid order total'; END IF;
  NEW.currency := l_currency; NEW.seller_id := l_seller;
  fee := ROUND((NEW.amount * 0.15)::numeric,2);
  NEW.platform_fee := fee; NEW.seller_earnings := NEW.amount-fee; NEW.status := 'completed';
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS orders_enforce_financials ON public.orders;
CREATE TRIGGER orders_enforce_financials BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enforce_order_financials();

-- ===== 20260927000000_full_hardening_and_search.sql =====
-- VELORA 2.4.1: final hardening + marketplace search suggestions.
-- Provider-owned financial/KYC state is server authoritative. Search suggestions
-- use catalog data plus anonymized aggregate query popularity.

-- ---------------------------------------------------------------------------
-- Financial / KYC authority
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.seller_payment_accounts FROM anon, authenticated;
DROP POLICY IF EXISTS "seller payment account owner" ON public.seller_payment_accounts;
-- No client policy: only service_role/server functions can read or mutate
-- provider account identifiers and provider capability state.

REVOKE INSERT, UPDATE, DELETE ON public.seller_verifications FROM authenticated;
DROP POLICY IF EXISTS "seller verification owner" ON public.seller_verifications;
DROP POLICY IF EXISTS "seller verification read own" ON public.seller_verifications;
CREATE POLICY "seller verification read own" ON public.seller_verifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

REVOKE INSERT, UPDATE, DELETE ON public.seller_verification_documents FROM authenticated;
DROP POLICY IF EXISTS "verification docs owner admin" ON public.seller_verification_documents;
DROP POLICY IF EXISTS "verification docs read own" ON public.seller_verification_documents;
CREATE POLICY "verification docs read own" ON public.seller_verification_documents
  FOR SELECT TO authenticated
  USING (
    verification_id IN (SELECT id FROM public.seller_verifications WHERE user_id = auth.uid())
    OR public.has_role(auth.uid(),'admin')
  );

REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM authenticated;
DROP POLICY IF EXISTS "subscription owner" ON public.subscriptions;
DROP POLICY IF EXISTS "subscription read own" ON public.subscriptions;
CREATE POLICY "subscription read own" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Email queue is an internal operation. Client users never get direct access.
REVOKE ALL ON public.email_outbox FROM anon, authenticated;
GRANT ALL ON public.email_outbox TO service_role;

-- ---------------------------------------------------------------------------
-- Active-listing child edits must go back through moderation.
-- Service-role/admin moderation remains the trusted publish path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_active_listing_child_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  listing_uuid UUID;
  current_status TEXT;
BEGIN
  listing_uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.listing_id ELSE NEW.listing_id END;
  SELECT status INTO current_status FROM public.listings WHERE id = listing_uuid;

  IF current_status = 'active' AND COALESCE(auth.role(), '') <> 'service_role' AND NOT public.has_role(auth.uid(), 'admin') THEN
    UPDATE public.listings
    SET status = 'pending', review_note = 'Listing content changed and requires moderation review.'
    WHERE id = listing_uuid AND status = 'active';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS listing_product_details_moderation_guard ON public.listing_product_details;
CREATE TRIGGER listing_product_details_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.listing_product_details
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

DROP TRIGGER IF EXISTS listing_media_moderation_guard ON public.listing_media;
CREATE TRIGGER listing_media_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.listing_media
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

DROP TRIGGER IF EXISTS listing_assets_moderation_guard ON public.listing_assets;
CREATE TRIGGER listing_assets_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.listing_assets
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

DROP TRIGGER IF EXISTS listing_faq_moderation_guard ON public.listing_faq;
CREATE TRIGGER listing_faq_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.listing_faq
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

DROP TRIGGER IF EXISTS product_variants_moderation_guard ON public.product_variants;
CREATE TRIGGER product_variants_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

REVOKE ALL ON FUNCTION public.enforce_active_listing_child_moderation() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Search query suggestions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.search_query_stats (
  normalized_query TEXT PRIMARY KEY,
  display_query TEXT NOT NULL,
  search_count BIGINT NOT NULL DEFAULT 0 CHECK (search_count >= 0),
  last_searched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.search_query_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.search_query_stats FROM anon, authenticated;
GRANT ALL ON public.search_query_stats TO service_role;

CREATE OR REPLACE FUNCTION public.record_search_query(p_query TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE normalized TEXT := lower(regexp_replace(trim(coalesce(p_query, '')), '[[:space:]]+', ' ', 'g'));
BEGIN
  IF length(normalized) < 2 OR length(normalized) > 80 THEN RETURN; END IF;
  IF normalized ~ '[<>]' OR normalized ~ '@' OR normalized ~* 'https?://' OR normalized ~ '^[0-9 +().-]{7,}$' THEN RETURN; END IF;
  INSERT INTO public.search_query_stats(normalized_query, display_query, search_count, last_searched_at)
  VALUES (normalized, trim(p_query), 1, now())
  ON CONFLICT (normalized_query) DO UPDATE SET
    display_query = EXCLUDED.display_query,
    search_count = search_query_stats.search_count + 1,
    last_searched_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.record_search_query(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_search_query(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_listing_ids(p_query TEXT, p_limit INTEGER DEFAULT 500)
RETURNS TABLE(listing_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT l.id
  FROM listings l
  LEFT JOIN listing_product_details d ON d.listing_id = l.id
  LEFT JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(d.tags) = 'array' THEN d.tags ELSE '[]'::jsonb END
  ) tag(value) ON true
  WHERE l.status = 'active'
    AND length(trim(coalesce(p_query, ''))) >= 2
    AND (
      l.title ILIKE '%' || trim(p_query) || '%'
      OR coalesce(l.description, '') ILIKE '%' || trim(p_query) || '%'
      OR coalesce(l.category, '') ILIKE '%' || trim(p_query) || '%'
      OR tag.value ILIKE '%' || trim(p_query) || '%'
    )
  ORDER BY l.id
  LIMIT least(greatest(coalesce(p_limit, 500), 1), 500);
$$;
REVOKE ALL ON FUNCTION public.search_listing_ids(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_listing_ids(TEXT, INTEGER) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_suggestions(p_query TEXT, p_limit INTEGER DEFAULT 10)
RETURNS TABLE(
  suggestion_type TEXT,
  label TEXT,
  listing_id UUID,
  category TEXT,
  price NUMERIC,
  currency TEXT,
  popularity BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT lower(trim(coalesce(p_query, ''))) AS q, least(greatest(coalesce(p_limit, 10), 1), 12) AS lim
  ),
  query_hits AS (
    SELECT 'query'::TEXT AS suggestion_type, s.display_query AS label, NULL::UUID AS listing_id,
           NULL::TEXT AS category, NULL::NUMERIC AS price, NULL::TEXT AS currency, s.search_count AS popularity
    FROM search_query_stats s, params p
    WHERE length(p.q) >= 2 AND s.normalized_query LIKE '%' || p.q || '%'
    ORDER BY s.search_count DESC, s.last_searched_at DESC
    LIMIT 4
  ),
  product_hits AS (
    SELECT DISTINCT ON (l.id)
      'product'::TEXT, l.title, l.id, l.category, l.price, l.currency, l.sales_count::BIGINT
    FROM listings l, params p
    WHERE l.status = 'active'
      AND length(p.q) >= 2
      AND (l.title ILIKE '%' || p.q || '%' OR coalesce(l.description, '') ILIKE '%' || p.q || '%')
    ORDER BY l.id, l.sales_count DESC, l.created_at DESC
    LIMIT 5
  ),
  category_hits AS (
    SELECT 'category'::TEXT, l.category, NULL::UUID, l.category, NULL::NUMERIC, NULL::TEXT,
           count(*)::BIGINT
    FROM listings l, params p
    WHERE l.status = 'active' AND l.category IS NOT NULL AND length(p.q) >= 2
      AND l.category ILIKE '%' || p.q || '%'
    GROUP BY l.category
    ORDER BY count(*) DESC, l.category
    LIMIT 3
  ),
  tag_hits AS (
    SELECT 'tag'::TEXT, lower(tag.value), NULL::UUID, NULL::TEXT, NULL::NUMERIC, NULL::TEXT, count(*)::BIGINT
    FROM listing_product_details d
    JOIN listings l ON l.id = d.listing_id
    CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.tags) = 'array' THEN d.tags ELSE '[]'::jsonb END) tag(value)
    CROSS JOIN params p
    WHERE l.status = 'active' AND length(p.q) >= 2 AND tag.value ILIKE '%' || p.q || '%'
    GROUP BY lower(tag.value)
    ORDER BY count(*) DESC, lower(tag.value)
    LIMIT 4
  )
  SELECT * FROM query_hits
  UNION ALL SELECT * FROM product_hits
  UNION ALL SELECT * FROM category_hits
  UNION ALL SELECT * FROM tag_hits
  LIMIT (SELECT lim FROM params);
$$;
REVOKE ALL ON FUNCTION public.search_suggestions(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_suggestions(TEXT, INTEGER) TO anon, authenticated;

-- Coupon redemption counter is incremented only when a new redemption row is
-- actually inserted. This keeps counters consistent under webhook retries.
CREATE OR REPLACE FUNCTION public.consume_coupon(p_coupon_id UUID, p_buyer_id UUID, p_order_id UUID, p_amount NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inserted_count INTEGER;
BEGIN
  INSERT INTO public.coupon_redemptions(coupon_id, buyer_id, order_id, amount)
  VALUES (p_coupon_id, p_buyer_id, p_order_id, p_amount)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count = 1 THEN
    UPDATE public.coupons
    SET redeemed_count = redeemed_count + 1
    WHERE id = p_coupon_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_coupon(UUID, UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_coupon(UUID, UUID, UUID, NUMERIC) TO service_role;

-- Server-side normalization for seller-entered tags. The UI already prevents
-- duplicates, but the database must enforce the same basic shape for direct API clients.
CREATE OR REPLACE FUNCTION public.normalize_listing_product_tags()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE cleaned JSONB;
BEGIN
  IF jsonb_typeof(NEW.tags) <> 'array' THEN
    RAISE EXCEPTION 'Tags must be an array';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(tag) ORDER BY lower(tag)), '[]'::jsonb)
  INTO cleaned
  FROM (
    SELECT DISTINCT lower(left(trim(value), 48)) AS tag
    FROM jsonb_array_elements_text(NEW.tags) AS e(value)
    WHERE length(trim(value)) BETWEEN 1 AND 48
    LIMIT 12
  ) normalized;
  NEW.tags := cleaned;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_listing_product_tags ON public.listing_product_details;
CREATE TRIGGER normalize_listing_product_tags
BEFORE INSERT OR UPDATE OF tags ON public.listing_product_details
FOR EACH ROW EXECUTE FUNCTION public.normalize_listing_product_tags();
REVOKE ALL ON FUNCTION public.normalize_listing_product_tags() FROM PUBLIC, anon, authenticated;

-- Other seller-authored listing content also re-enters moderation when an
-- already-active listing is changed.
DROP TRIGGER IF EXISTS product_updates_moderation_guard ON public.product_updates;
CREATE TRIGGER product_updates_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.product_updates
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

DROP TRIGGER IF EXISTS listing_versions_moderation_guard ON public.listing_versions;
CREATE TRIGGER listing_versions_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.listing_versions
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

-- The private profiles table contains account email addresses. Public creator
-- cards use public_profiles, so the base table should not be globally readable.
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
DROP POLICY IF EXISTS "profiles readable by all" ON public.profiles;
DROP POLICY IF EXISTS "users read own profile" ON public.profiles;
CREATE POLICY "users read own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

-- ===== 20261028010000_velora_usd_only.sql =====
-- VELORA v3: all new marketplace pricing is denominated in USD.
-- Historical rows are deliberately not converted: conversion requires a dated FX rate and must not silently change prices.
-- Existing non-USD active listings are moved to pending review before new USD-only triggers are installed.
UPDATE public.listings SET status = 'pending', review_note = 'VELORA USD migration: review and reprice this legacy non-USD listing before publication.' WHERE upper(coalesce(currency, '')) <> 'USD' AND status = 'active';
CREATE OR REPLACE FUNCTION public.enforce_velora_usd_currency()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF upper(coalesce(NEW.currency, '')) <> 'USD' THEN
    RAISE EXCEPTION 'VELORA supports USD-denominated marketplace prices only' USING ERRCODE = '22023';
  END IF;
  NEW.currency := 'USD';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS velora_listings_usd_currency ON public.listings;
CREATE TRIGGER velora_listings_usd_currency BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.enforce_velora_usd_currency();

DROP TRIGGER IF EXISTS velora_variants_usd_currency ON public.product_variants;
CREATE TRIGGER velora_variants_usd_currency BEFORE INSERT OR UPDATE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.enforce_velora_usd_currency();

-- Requests use the same marketplace currency where the schema has a currency field.
DO $$ BEGIN
  IF to_regclass('public.website_requests') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS velora_website_requests_usd_currency ON public.website_requests';
    EXECUTE 'CREATE TRIGGER velora_website_requests_usd_currency BEFORE INSERT OR UPDATE OF currency ON public.website_requests FOR EACH ROW EXECUTE FUNCTION public.enforce_velora_usd_currency()';
  END IF;
END $$;

-- Publishing requires a completed clean scan for every uploaded delivery asset.
-- This prevents an unconfigured/failed scanner from silently allowing delivery.
CREATE OR REPLACE FUNCTION public.enforce_listing_moderation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asset_count INTEGER;
  detail_count INTEGER;
  clean_asset_count INTEGER;
  unsafe_scan_count INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'pending';
    ELSIF NEW.status = 'active' THEN
      NEW.status := 'pending';
    END IF;
  END IF;

  IF NEW.status = 'active' THEN
    SELECT count(*) INTO asset_count FROM public.listing_assets WHERE listing_id = NEW.id;
    SELECT count(*) INTO detail_count FROM public.listing_product_details WHERE listing_id = NEW.id;
    IF asset_count < 1 OR detail_count < 1 OR NEW.cover_url IS NULL OR length(trim(NEW.cover_url)) < 8 THEN
      RAISE EXCEPTION 'Listing cannot be published until Product Studio details, cover media, and at least one delivery asset exist';
    END IF;

    SELECT count(DISTINCT asset_id) INTO clean_asset_count
      FROM public.malware_scans WHERE listing_id = NEW.id AND status = 'clean' AND asset_id IS NOT NULL;
    SELECT count(*) INTO unsafe_scan_count
      FROM public.malware_scans WHERE listing_id = NEW.id AND status <> 'clean';
    IF clean_asset_count < asset_count OR unsafe_scan_count > 0 THEN
      RAISE EXCEPTION 'Listing cannot be published until every delivery asset has a clean malware scan';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_listing_moderation_guard() FROM PUBLIC, anon, authenticated;

-- Reapply this policy in the new migration as well, so already-deployed databases
-- receive the fix without needing to rerun an older migration.
DROP POLICY IF EXISTS "product updates readable" ON public.product_updates;
DROP POLICY IF EXISTS "product updates readable" ON public.product_updates;
CREATE POLICY "product updates readable" ON public.product_updates FOR SELECT
USING (
  auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id)
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.listing_id = product_updates.listing_id
      AND o.buyer_id = auth.uid()
      AND o.status = 'completed'
  )
);

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

-- ===== 20261031120000_marketplace_upgrade.sql =====
-- VELORA marketplace upgrade — Wave A (additive only).
--
-- Adds the data foundation for the master upgrade specification:
--   * categories (admin-managed product categories with subcategories)
--   * professional profile fields on profiles (headline, skills, portfolio…)
--   * rich package fields + fine-grained project_status on website_requests
--   * project_proposals (proposal flow replacing first-come claiming)
--   * project_milestones / project_deliveries / project_revisions (workspace)
--   * profile_portfolio, saved_developers
--   * RPCs: select_project_proposal(), transition_project_status()
--
-- Nothing is dropped or altered destructively. Existing columns, the legacy
-- website_requests.status flow ('open'/'taken'/'completed'/'cancelled') and
-- the claim/complete RPCs keep working; the new project_status column tracks
-- the 15-state project lifecycle alongside them.
--
-- User references follow the existing pattern (website_requests.requester_id):
-- FKs point at auth.users(id). Admin checks use public.has_role(uid, 'admin').

-- --------------------------------------------------------------------------
-- Categories
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS categories_parent_idx ON public.categories (parent_id, sort_order);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
DROP POLICY IF EXISTS "active categories are public" ON public.categories;
DROP POLICY IF EXISTS "active categories are public" ON public.categories;
CREATE POLICY "active categories are public" ON public.categories FOR SELECT
  USING (is_active OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "admins manage categories" ON public.categories;
DROP POLICY IF EXISTS "admins manage categories" ON public.categories;
CREATE POLICY "admins manage categories" ON public.categories FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS update_categories_updated_at ON public.categories;
CREATE TRIGGER update_categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.categories (name, slug, sort_order) VALUES
  ('WordPress', 'wordpress', 1),
  ('PHP Scripts', 'php-scripts', 2),
  ('HTML Templates', 'html-templates', 3),
  ('Website Templates', 'website-templates', 4),
  ('Mobile Applications', 'mobile-applications', 5),
  ('UI Kits', 'ui-kits', 6),
  ('Plugins', 'plugins', 7),
  ('Graphics', 'graphics', 8),
  ('Themes', 'themes', 9),
  ('Software', 'software', 10),
  ('Other', 'other', 11)
ON CONFLICT (slug) DO NOTHING;

-- --------------------------------------------------------------------------
-- Professional profile fields on profiles
-- --------------------------------------------------------------------------
-- The existing profiles RLS ("users update own profile", auth.uid() = id)
-- already covers these columns; no policy changes are needed or made.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS headline TEXT,
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS experience_level TEXT,
  ADD COLUMN IF NOT EXISTS years_experience INTEGER,
  ADD COLUMN IF NOT EXISTS availability TEXT,
  ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);

-- --------------------------------------------------------------------------
-- Website requests: package fields + project lifecycle
-- --------------------------------------------------------------------------
ALTER TABLE public.website_requests
  ADD COLUMN IF NOT EXISTS package_type TEXT,
  ADD COLUMN IF NOT EXISTS required_pages TEXT,
  ADD COLUMN IF NOT EXISTS required_functionality TEXT,
  ADD COLUMN IF NOT EXISTS preferred_technologies TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS design_references TEXT,
  ADD COLUMN IF NOT EXISTS reference_urls TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS domain_needs TEXT,
  ADD COLUMN IF NOT EXISTS hosting_needs TEXT,
  ADD COLUMN IF NOT EXISTS deadline DATE,
  ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreed_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS agreed_currency TEXT,
  ADD COLUMN IF NOT EXISTS selected_proposal_id UUID,
  ADD COLUMN IF NOT EXISTS project_status TEXT;

-- project_status is NULL for legacy rows (derived from status by the RPCs);
-- when set it must be one of the 15 lifecycle states from the specification.
ALTER TABLE public.website_requests
  DROP CONSTRAINT IF EXISTS website_requests_project_status_check;
ALTER TABLE public.website_requests
  ADD CONSTRAINT website_requests_project_status_check
  CHECK (project_status IS NULL OR project_status IN (
    'draft', 'pending_review', 'open', 'proposals_received',
    'developer_selected', 'awaiting_agreement', 'awaiting_payment',
    'in_progress', 'preview_submitted', 'revision_requested',
    'final_submitted', 'completed', 'cancelled', 'disputed', 'refunded'
  ));
CREATE INDEX IF NOT EXISTS website_requests_project_status_idx
  ON public.website_requests (project_status, created_at DESC);

-- --------------------------------------------------------------------------
-- Project proposals
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  developer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  proposed_amount NUMERIC(12,2),
  currency TEXT NOT NULL DEFAULT 'USD',
  estimated_days INTEGER,
  portfolio_urls TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_proposals_request_idx
  ON public.project_proposals (request_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS project_proposals_developer_idx
  ON public.project_proposals (developer_id, created_at DESC);
-- A request can have at most one accepted proposal (single assignment), and a
-- developer can have at most one pending proposal per request.
CREATE UNIQUE INDEX IF NOT EXISTS project_proposals_one_accepted_idx
  ON public.project_proposals (request_id) WHERE status = 'accepted';
CREATE UNIQUE INDEX IF NOT EXISTS project_proposals_one_pending_per_dev_idx
  ON public.project_proposals (request_id, developer_id) WHERE status = 'pending';
ALTER TABLE public.project_proposals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_proposals TO authenticated;
GRANT ALL ON public.project_proposals TO service_role;
DROP POLICY IF EXISTS "proposal participants read" ON public.project_proposals;
DROP POLICY IF EXISTS "proposal participants read" ON public.project_proposals;
CREATE POLICY "proposal participants read" ON public.project_proposals FOR SELECT
  TO authenticated
  USING (
    auth.uid() = developer_id
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "developers create proposals" ON public.project_proposals;
DROP POLICY IF EXISTS "developers create proposals" ON public.project_proposals;
CREATE POLICY "developers create proposals" ON public.project_proposals FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = developer_id
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id <> auth.uid()
    )
  );
DROP POLICY IF EXISTS "proposal participants update" ON public.project_proposals;
DROP POLICY IF EXISTS "proposal participants update" ON public.project_proposals;
CREATE POLICY "proposal participants update" ON public.project_proposals FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = developer_id
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = developer_id
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "developers delete own proposals" ON public.project_proposals;
DROP POLICY IF EXISTS "developers delete own proposals" ON public.project_proposals;
CREATE POLICY "developers delete own proposals" ON public.project_proposals FOR DELETE
  TO authenticated
  USING (auth.uid() = developer_id OR public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS update_project_proposals_updated_at ON public.project_proposals;
CREATE TRIGGER update_project_proposals_updated_at
  BEFORE UPDATE ON public.project_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Now that project_proposals exists, link the selected proposal from the request.
ALTER TABLE public.website_requests
  DROP CONSTRAINT IF EXISTS website_requests_selected_proposal_fkey;
ALTER TABLE public.website_requests
  ADD CONSTRAINT website_requests_selected_proposal_fkey
  FOREIGN KEY (selected_proposal_id) REFERENCES public.project_proposals(id) ON DELETE SET NULL;

-- --------------------------------------------------------------------------
-- Project milestones
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'done')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_milestones_request_idx
  ON public.project_milestones (request_id, sort_order);
ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_milestones TO authenticated;
GRANT ALL ON public.project_milestones TO service_role;
DROP POLICY IF EXISTS "milestone participants read" ON public.project_milestones;
DROP POLICY IF EXISTS "milestone participants read" ON public.project_milestones;
CREATE POLICY "milestone participants read" ON public.project_milestones FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "milestone participants insert" ON public.project_milestones;
DROP POLICY IF EXISTS "milestone participants insert" ON public.project_milestones;
CREATE POLICY "milestone participants insert" ON public.project_milestones FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "milestone participants update" ON public.project_milestones;
DROP POLICY IF EXISTS "milestone participants update" ON public.project_milestones;
CREATE POLICY "milestone participants update" ON public.project_milestones FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "milestone participants delete" ON public.project_milestones;
DROP POLICY IF EXISTS "milestone participants delete" ON public.project_milestones;
CREATE POLICY "milestone participants delete" ON public.project_milestones FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP TRIGGER IF EXISTS update_project_milestones_updated_at ON public.project_milestones;
CREATE TRIGGER update_project_milestones_updated_at
  BEFORE UPDATE ON public.project_milestones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- --------------------------------------------------------------------------
-- Project deliveries (previews + final handovers)
-- --------------------------------------------------------------------------
-- Delivery files live in the existing private `listing-files` bucket; only
-- object paths are stored here, never public URLs (signed URLs are minted by
-- the app after an RLS/ownership check). No new bucket or storage policy is
-- required for this wave.
CREATE TABLE IF NOT EXISTS public.project_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('preview', 'final')),
  preview_url TEXT,
  final_url TEXT,
  file_paths TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'revision_requested')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_deliveries_request_idx
  ON public.project_deliveries (request_id, created_at DESC);
ALTER TABLE public.project_deliveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.project_deliveries TO authenticated;
GRANT ALL ON public.project_deliveries TO service_role;
DROP POLICY IF EXISTS "delivery participants read" ON public.project_deliveries;
DROP POLICY IF EXISTS "delivery participants read" ON public.project_deliveries;
CREATE POLICY "delivery participants read" ON public.project_deliveries FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "assigned developer submits deliveries" ON public.project_deliveries;
DROP POLICY IF EXISTS "assigned developer submits deliveries" ON public.project_deliveries;
CREATE POLICY "assigned developer submits deliveries" ON public.project_deliveries FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = submitted_by
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.taken_by = auth.uid()
    )
  );
-- Requesters update a delivery to approve it or request a revision (the UI
-- only changes `status`; RLS scopes the row set, column narrowing happens in
-- the app/RPC layer). Admins can update for moderation.
DROP POLICY IF EXISTS "requester reviews deliveries" ON public.project_deliveries;
DROP POLICY IF EXISTS "requester reviews deliveries" ON public.project_deliveries;
CREATE POLICY "requester reviews deliveries" ON public.project_deliveries FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id = auth.uid()
    )
  );

-- --------------------------------------------------------------------------
-- Project revisions
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  delivery_id UUID NOT NULL REFERENCES public.project_deliveries(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notes TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_revisions_request_idx
  ON public.project_revisions (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_revisions_delivery_idx
  ON public.project_revisions (delivery_id, created_at DESC);
ALTER TABLE public.project_revisions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.project_revisions TO authenticated;
GRANT ALL ON public.project_revisions TO service_role;
DROP POLICY IF EXISTS "revision participants read" ON public.project_revisions;
DROP POLICY IF EXISTS "revision participants read" ON public.project_revisions;
CREATE POLICY "revision participants read" ON public.project_revisions FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "requester creates revisions" ON public.project_revisions;
DROP POLICY IF EXISTS "requester creates revisions" ON public.project_revisions;
CREATE POLICY "requester creates revisions" ON public.project_revisions FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = requested_by
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id = auth.uid()
    )
  );

-- --------------------------------------------------------------------------
-- Profile portfolio
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_portfolio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  image_url TEXT,
  technologies TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_portfolio_user_idx
  ON public.profile_portfolio (user_id, sort_order);
ALTER TABLE public.profile_portfolio ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profile_portfolio TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.profile_portfolio TO authenticated;
GRANT ALL ON public.profile_portfolio TO service_role;
DROP POLICY IF EXISTS "portfolio is public" ON public.profile_portfolio;
DROP POLICY IF EXISTS "portfolio is public" ON public.profile_portfolio;
CREATE POLICY "portfolio is public" ON public.profile_portfolio FOR SELECT USING (true);
DROP POLICY IF EXISTS "owner manages portfolio" ON public.profile_portfolio;
DROP POLICY IF EXISTS "owner manages portfolio" ON public.profile_portfolio;
CREATE POLICY "owner manages portfolio" ON public.profile_portfolio FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS update_profile_portfolio_updated_at ON public.profile_portfolio;
CREATE TRIGGER update_profile_portfolio_updated_at
  BEFORE UPDATE ON public.profile_portfolio
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- --------------------------------------------------------------------------
-- Saved developers
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saved_developers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  developer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, developer_id)
);
CREATE INDEX IF NOT EXISTS saved_developers_developer_idx
  ON public.saved_developers (developer_id);
ALTER TABLE public.saved_developers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.saved_developers TO authenticated;
GRANT ALL ON public.saved_developers TO service_role;
DROP POLICY IF EXISTS "users manage own saved developers" ON public.saved_developers;
DROP POLICY IF EXISTS "users manage own saved developers" ON public.saved_developers;
CREATE POLICY "users manage own saved developers" ON public.saved_developers FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND user_id <> developer_id);

-- --------------------------------------------------------------------------
-- RPC: select a proposal (mirrors the claim flow's status semantics)
-- --------------------------------------------------------------------------
-- claim_website_request() sets status='taken', taken_by and taken_at. This
-- RPC does exactly the same once the requester picks a proposal, and also
-- records selected_proposal_id and project_status='developer_selected'.
CREATE OR REPLACE FUNCTION public.select_project_proposal(p_request_id UUID, p_proposal_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.website_requests%ROWTYPE;
  v_proposal public.project_proposals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_request FROM public.website_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Website request not found';
  END IF;

  IF v_request.requester_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only the request owner can select a proposal';
  END IF;

  -- Mirror the claim guard: an already-taken request cannot be re-assigned.
  IF v_request.taken_by IS NOT NULL OR v_request.status <> 'open' THEN
    RAISE EXCEPTION 'Request is no longer open for selection';
  END IF;

  SELECT * INTO v_proposal FROM public.project_proposals
  WHERE id = p_proposal_id AND request_id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found for this request';
  END IF;

  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'Proposal is not pending';
  END IF;

  IF v_proposal.developer_id = v_request.requester_id THEN
    RAISE EXCEPTION 'A requester cannot be selected for their own request';
  END IF;

  -- Reject the other pending proposals first so the one-accepted partial
  -- unique index can never be violated mid-flight.
  UPDATE public.project_proposals
  SET status = 'rejected', updated_at = now()
  WHERE request_id = p_request_id AND status = 'pending' AND id <> p_proposal_id;

  UPDATE public.project_proposals
  SET status = 'accepted', updated_at = now()
  WHERE id = p_proposal_id;

  UPDATE public.website_requests
  SET status = 'taken',
      taken_by = v_proposal.developer_id,
      taken_at = now(),
      selected_proposal_id = p_proposal_id,
      project_status = 'developer_selected',
      is_draft = false,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.select_project_proposal(UUID, UUID) TO authenticated;

-- --------------------------------------------------------------------------
-- RPC: validated project status transitions
-- --------------------------------------------------------------------------
-- project_status is the fine-grained lifecycle from the specification; the
-- legacy status column is kept in sync ('open'/'taken'/'completed'/
-- 'cancelled') so existing pages keep working.
--
-- Role rules (pragmatic):
--   * admin       — any allowed transition.
--   * requester   — submission flow (draft/pending_review/open), marking
--                   proposals received, agreement/payment stages, revision
--                   requests, approval to completed, cancel, dispute.
--   * developer   — work flow (in_progress, preview/final submitted),
--                   dispute. The developer cannot cancel or mark completed.
--   * refunded    — admin only.
CREATE OR REPLACE FUNCTION public.transition_project_status(p_request_id UUID, p_status TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.website_requests%ROWTYPE;
  v_from TEXT;
  v_is_admin BOOLEAN;
  v_is_requester BOOLEAN;
  v_is_developer BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_status NOT IN (
    'draft', 'pending_review', 'open', 'proposals_received',
    'developer_selected', 'awaiting_agreement', 'awaiting_payment',
    'in_progress', 'preview_submitted', 'revision_requested',
    'final_submitted', 'completed', 'cancelled', 'disputed', 'refunded'
  ) THEN
    RAISE EXCEPTION 'Unknown project status: %', p_status;
  END IF;

  SELECT * INTO v_request FROM public.website_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Website request not found';
  END IF;

  v_is_admin := public.has_role(auth.uid(), 'admin');
  v_is_requester := v_request.requester_id = auth.uid();
  v_is_developer := v_request.taken_by IS NOT NULL AND v_request.taken_by = auth.uid();

  IF NOT (v_is_admin OR v_is_requester OR v_is_developer) THEN
    RAISE EXCEPTION 'Only project participants can change the project status';
  END IF;

  -- Effective current state: project_status when set, else derive from the
  -- legacy status used by rows created before this migration.
  v_from := COALESCE(v_request.project_status, CASE v_request.status
    WHEN 'open' THEN 'open'
    WHEN 'taken' THEN 'in_progress'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
  END);

  IF v_from = p_status THEN
    RETURN true; -- already there; idempotent no-op
  END IF;

  -- Allowed transition graph.
  IF NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('draft', 'pending_review'), ('draft', 'open'), ('draft', 'cancelled'),
      ('pending_review', 'open'), ('pending_review', 'draft'), ('pending_review', 'cancelled'),
      ('open', 'proposals_received'), ('open', 'developer_selected'), ('open', 'cancelled'),
      ('proposals_received', 'developer_selected'), ('proposals_received', 'open'), ('proposals_received', 'cancelled'),
      ('developer_selected', 'awaiting_agreement'), ('developer_selected', 'awaiting_payment'),
      ('developer_selected', 'in_progress'), ('developer_selected', 'cancelled'), ('developer_selected', 'disputed'),
      ('awaiting_agreement', 'awaiting_payment'), ('awaiting_agreement', 'in_progress'),
      ('awaiting_agreement', 'cancelled'), ('awaiting_agreement', 'disputed'),
      ('awaiting_payment', 'in_progress'), ('awaiting_payment', 'cancelled'), ('awaiting_payment', 'disputed'),
      ('in_progress', 'preview_submitted'), ('in_progress', 'final_submitted'),
      ('in_progress', 'cancelled'), ('in_progress', 'disputed'),
      ('preview_submitted', 'revision_requested'), ('preview_submitted', 'in_progress'),
      ('preview_submitted', 'final_submitted'), ('preview_submitted', 'disputed'),
      ('revision_requested', 'in_progress'), ('revision_requested', 'preview_submitted'), ('revision_requested', 'disputed'),
      ('final_submitted', 'completed'), ('final_submitted', 'revision_requested'), ('final_submitted', 'disputed'),
      ('completed', 'disputed'), ('completed', 'refunded'),
      ('disputed', 'in_progress'), ('disputed', 'completed'), ('disputed', 'cancelled'), ('disputed', 'refunded')
    ) AS t(f, tt)
    WHERE t.f = v_from AND t.tt = p_status
  ) THEN
    RAISE EXCEPTION 'Project status transition % -> % is not allowed', v_from, p_status;
  END IF;

  -- Role rules on top of the graph.
  IF p_status = 'refunded' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only an admin can mark a project refunded';
  END IF;
  IF p_status = 'cancelled' AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can cancel a project';
  END IF;
  IF p_status = 'completed' AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can approve completion';
  END IF;
  IF p_status = 'revision_requested' AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can request a revision';
  END IF;
  IF p_status IN ('preview_submitted', 'final_submitted') AND NOT (v_is_admin OR v_is_developer) THEN
    RAISE EXCEPTION 'Only the assigned developer can submit work';
  END IF;
  IF p_status IN ('draft', 'pending_review', 'open', 'proposals_received',
                  'awaiting_agreement', 'awaiting_payment')
     AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can move the project through this stage';
  END IF;
  IF p_status = 'in_progress' AND NOT (v_is_admin OR v_is_developer OR (v_is_requester AND v_from = 'awaiting_payment')) THEN
    RAISE EXCEPTION 'Only the assigned developer can move the project into progress';
  END IF;

  UPDATE public.website_requests
  SET project_status = p_status,
      is_draft = (p_status = 'draft'),
      status = CASE
        WHEN p_status = 'completed' THEN 'completed'
        WHEN p_status = 'cancelled' THEN 'cancelled'
        WHEN taken_by IS NOT NULL AND p_status IN (
          'developer_selected', 'awaiting_agreement', 'awaiting_payment',
          'in_progress', 'preview_submitted', 'revision_requested', 'final_submitted'
        ) THEN 'taken'
        WHEN p_status IN ('open', 'proposals_received', 'pending_review') THEN 'open'
        ELSE status
      END,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transition_project_status(UUID, TEXT) TO authenticated;

-- ===== 20261031130000_wave_b_public_profiles.sql =====
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

-- ===== 20261031140000_wave_c_projects.sql =====
-- VELORA marketplace upgrade — Wave C (additive only).
--
-- Supports the custom website projects marketplace UI:
--   * website_requests gains the remaining request-form fields from the
--     specification (category, website purpose, target audience).
--   * website_requests_public is rebuilt so the public board can show the
--     Wave A package/lifecycle fields — and so drafts are never exposed
--     publicly. The view still never selects `contact` or any other private
--     column; the column order of the original view is preserved and new
--     columns are appended.
--   * Proposal notifications follow the platform's existing pattern
--     (SECURITY DEFINER trigger functions inserting into public.notifications,
--     as notify_seller_new_order() does for orders): the request owner is
--     notified of a new proposal, and a developer is notified when their
--     proposal is accepted or rejected. The notifications table has no
--     client INSERT policy, so triggers are the only supported write path.

-- --------------------------------------------------------------------------
-- Remaining request-form fields
-- --------------------------------------------------------------------------
ALTER TABLE public.website_requests
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS purpose TEXT,
  ADD COLUMN IF NOT EXISTS target_audience TEXT;

-- --------------------------------------------------------------------------
-- Public request board view (drafts excluded, package fields included)
-- --------------------------------------------------------------------------
DROP VIEW IF EXISTS public.website_requests_public;
CREATE VIEW public.website_requests_public AS
SELECT id, requester_id, title, description, budget, currency, status, taken_by, taken_at,
       created_at, updated_at, tier, photos,
       package_type, project_status, category, purpose, target_audience,
       required_pages, required_functionality, preferred_technologies,
       design_references, reference_urls, domain_needs, hosting_needs, deadline,
       is_draft, agreed_amount, agreed_currency, selected_proposal_id
FROM public.website_requests
WHERE NOT is_draft;
GRANT SELECT ON public.website_requests_public TO anon, authenticated;

-- --------------------------------------------------------------------------
-- Proposal notifications (existing trigger pattern)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_requester_new_proposal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_requester UUID;
BEGIN
  SELECT title, requester_id INTO v_title, v_requester
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_requester IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body)
    VALUES (v_requester, 'New proposal received',
            'A developer sent a proposal for "' || COALESCE(v_title, 'your website request') || '".');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_new_proposal ON public.project_proposals;
CREATE TRIGGER trg_notify_new_proposal
  AFTER INSERT ON public.project_proposals
  FOR EACH ROW EXECUTE FUNCTION public.notify_requester_new_proposal();

CREATE OR REPLACE FUNCTION public.notify_developer_proposal_decision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
BEGIN
  IF NEW.status NOT IN ('accepted', 'rejected') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT title INTO v_title FROM public.website_requests WHERE id = NEW.request_id;
  INSERT INTO public.notifications (user_id, title, body)
  VALUES (
    NEW.developer_id,
    CASE WHEN NEW.status = 'accepted' THEN 'Proposal accepted' ELSE 'Proposal rejected' END,
    CASE WHEN NEW.status = 'accepted'
      THEN 'Your proposal for "' || COALESCE(v_title, 'a website request') || '" was accepted. The project is now assigned to you.'
      ELSE 'Your proposal for "' || COALESCE(v_title, 'a website request') || '" was not selected this time.'
    END
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_proposal_decision ON public.project_proposals;
CREATE TRIGGER trg_notify_proposal_decision
  AFTER UPDATE OF status ON public.project_proposals
  FOR EACH ROW EXECUTE FUNCTION public.notify_developer_proposal_decision();

-- ===== 20261031150000_wave_d_workspace.sql =====
-- VELORA marketplace upgrade — Wave D (additive only).
--
-- Supports the project workspace UI (route /projects/$id):
--   * project_messages — private chat between a website request's two
--     participants (requester + assigned developer). The existing
--     conversations/messages tables are buyer<->seller messaging tied to
--     listings (listing_id FK) and cannot reference a website request, so
--     project chat gets its own table instead of overloading them.
--   * Storage policies for delivery/chat files in the existing private
--     `listing-files` bucket under the `projects/<request_id>/...` prefix.
--     The bucket's long-standing policies are folder-owner based (seller
--     files), which would stop a client from ever opening the assigned
--     developer's delivery files; these policies scope access to the
--     project's participants (and admins) for that prefix only.
--   * Workspace notifications follow the platform's existing pattern
--     (SECURITY DEFINER trigger functions inserting into
--     public.notifications, as in the Wave C proposal triggers): new chat
--     message, preview/final delivery submitted, revision requested, and
--     delivery approved. The notifications table has no client INSERT
--     policy, so triggers remain the only supported write path.

-- --------------------------------------------------------------------------
-- Project messages (workspace chat)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  attachment_paths TEXT[] NOT NULL DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_messages_request_idx
  ON public.project_messages (request_id, created_at);
ALTER TABLE public.project_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.project_messages TO authenticated;
GRANT ALL ON public.project_messages TO service_role;
DROP POLICY IF EXISTS "project message participants read" ON public.project_messages;
DROP POLICY IF EXISTS "project message participants read" ON public.project_messages;
CREATE POLICY "project message participants read" ON public.project_messages FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "project participants send messages" ON public.project_messages;
DROP POLICY IF EXISTS "project participants send messages" ON public.project_messages;
CREATE POLICY "project participants send messages" ON public.project_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
-- Only the recipient marks a message read (the UI updates read_at on rows
-- sent by the other participant); admins may moderate.
DROP POLICY IF EXISTS "project message recipient marks read" ON public.project_messages;
DROP POLICY IF EXISTS "project message recipient marks read" ON public.project_messages;
CREATE POLICY "project message recipient marks read" ON public.project_messages FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      sender_id <> auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.website_requests wr
        WHERE wr.id = request_id
          AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (
      sender_id <> auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.website_requests wr
        WHERE wr.id = request_id
          AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
      )
    )
  );

-- --------------------------------------------------------------------------
-- Storage: project files in the private listing-files bucket
-- Path convention: projects/<request_id>/<file> and
--                  projects/<request_id>/chat/<file>
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "project participants upload project files" ON storage.objects;
DROP POLICY IF EXISTS "project participants upload project files" ON storage.objects;
CREATE POLICY "project participants upload project files" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'listing-files'
    AND (storage.foldername(name))[1] = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id::text = (storage.foldername(name))[2]
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "project participants read project files" ON storage.objects;
DROP POLICY IF EXISTS "project participants read project files" ON storage.objects;
CREATE POLICY "project participants read project files" ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'listing-files'
    AND (storage.foldername(name))[1] = 'projects'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.website_requests wr
        WHERE wr.id::text = (storage.foldername(name))[2]
          AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
      )
    )
  );
DROP POLICY IF EXISTS "project participants delete project files" ON storage.objects;
DROP POLICY IF EXISTS "project participants delete project files" ON storage.objects;
CREATE POLICY "project participants delete project files" ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'listing-files'
    AND (storage.foldername(name))[1] = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id::text = (storage.foldername(name))[2]
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );

-- --------------------------------------------------------------------------
-- Workspace notifications (existing trigger pattern — see Wave C)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_project_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_recipient UUID;
BEGIN
  SELECT title,
         CASE WHEN requester_id = NEW.sender_id THEN taken_by ELSE requester_id END
    INTO v_title, v_recipient
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_recipient IS NOT NULL AND v_recipient <> NEW.sender_id THEN
    INSERT INTO public.notifications (user_id, title, body)
    VALUES (v_recipient, 'New project message',
            'You have a new message in the workspace for "' || COALESCE(v_title, 'your website project') || '".');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_project_message ON public.project_messages;
CREATE TRIGGER trg_notify_project_message
  AFTER INSERT ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_project_message();

CREATE OR REPLACE FUNCTION public.notify_delivery_submitted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_requester UUID;
BEGIN
  SELECT title, requester_id INTO v_title, v_requester
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_requester IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body)
    VALUES (
      v_requester,
      CASE WHEN NEW.kind = 'final' THEN 'Final delivery submitted' ELSE 'Preview submitted' END,
      CASE WHEN NEW.kind = 'final'
        THEN 'The final delivery for "' || COALESCE(v_title, 'your website project') || '" is ready for your review.'
        ELSE 'A new preview (version ' || NEW.version || ') for "' || COALESCE(v_title, 'your website project') || '" is ready for your review.'
      END
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_delivery_submitted ON public.project_deliveries;
CREATE TRIGGER trg_notify_delivery_submitted
  AFTER INSERT ON public.project_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.notify_delivery_submitted();

CREATE OR REPLACE FUNCTION public.notify_revision_requested()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_developer UUID;
BEGIN
  SELECT title, taken_by INTO v_title, v_developer
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_developer IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body)
    VALUES (v_developer, 'Revision requested',
            'The client requested a revision on "' || COALESCE(v_title, 'your website project') || '".');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_revision_requested ON public.project_revisions;
CREATE TRIGGER trg_notify_revision_requested
  AFTER INSERT ON public.project_revisions
  FOR EACH ROW EXECUTE FUNCTION public.notify_revision_requested();

CREATE OR REPLACE FUNCTION public.notify_delivery_approved()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT title INTO v_title FROM public.website_requests WHERE id = NEW.request_id;
  INSERT INTO public.notifications (user_id, title, body)
  VALUES (
    NEW.submitted_by,
    'Delivery approved',
    'Your ' || NEW.kind || ' delivery (version ' || NEW.version || ') for "' ||
      COALESCE(v_title, 'a website project') || '" was approved.'
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_delivery_approved ON public.project_deliveries;
CREATE TRIGGER trg_notify_delivery_approved
  AFTER UPDATE OF status ON public.project_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.notify_delivery_approved();

-- ===== 20261031160000_wave_f_project_payments.sql =====
-- VELORA marketplace upgrade — Wave F (additive only).
--
-- Project payments for the custom website projects marketplace:
--   * project_payments records one row per Stripe Checkout attempt for a
--     website request whose developer has been selected and whose amount
--     has been agreed (website_requests.agreed_amount / agreed_currency).
--   * The 85/15 split is computed server-side at checkout creation and
--     stored on the row (platform_fee + developer_amount = amount), so the
--     amounts shown to both parties and used for payout records can never
--     drift from what was actually charged.
--   * Rows are written ONLY by trusted server code (checkout creation and
--     the Stripe webhook, both via the service role). Authenticated users
--     get read-only access scoped to the project's two participants
--     (requester + assigned developer) and admins — the same participant
--     pattern the Wave A workspace tables use. There is deliberately no
--     client INSERT/UPDATE/DELETE grant or policy: a payment's status can
--     never be forged from the browser.
--   * Payout execution stays with the existing seller payout system
--     (payout_requests / admin payout queue). This table is the auditable
--     record of what the developer is owed for a project; no payout row is
--     auto-created here because payout_requests balances on /earnings are
--     computed from product orders, and an unlinked project row would
--     corrupt that math.

-- --------------------------------------------------------------------------
-- Project payments
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  payer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_session_id TEXT UNIQUE,
  provider_payment_intent TEXT,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  platform_fee NUMERIC(12,2) NOT NULL,
  developer_amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'disputed', 'partially_refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_payments_request_idx
  ON public.project_payments (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_payments_payment_intent_idx
  ON public.project_payments (provider_payment_intent)
  WHERE provider_payment_intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_payments_payee_idx
  ON public.project_payments (payee_id, created_at DESC);
ALTER TABLE public.project_payments ENABLE ROW LEVEL SECURITY;
-- Read-only for authenticated participants/admins (see policy below);
-- all writes are service-role only.
GRANT SELECT ON public.project_payments TO authenticated;
GRANT ALL ON public.project_payments TO service_role;
DROP POLICY IF EXISTS "project payment participants read" ON public.project_payments;
DROP POLICY IF EXISTS "project payment participants read" ON public.project_payments;
CREATE POLICY "project payment participants read" ON public.project_payments FOR SELECT
  TO authenticated
  USING (
    auth.uid() = payer_id
    OR auth.uid() = payee_id
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP TRIGGER IF EXISTS update_project_payments_updated_at ON public.project_payments;
CREATE TRIGGER update_project_payments_updated_at
  BEFORE UPDATE ON public.project_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== 20261101120000_ecosystem_upgrade.sql =====
-- VELORA ecosystem upgrade — Wave M1 (additive only, data-preserving).
--
-- Contents:
--   1. BUG FIX: select_project_proposal() now records the agreed amount so
--      project checkout (createProjectCheckout) can actually run.
--   2. Direct messages: revive the dormant conversations/messages schema
--      from 20260926090000 (one general conversation per user pair,
--      last_message_at maintenance, DM notifications), user_blocks with
--      send-time enforcement, and profile/message reporting.
--   3. project_disputes: a reviewable dispute record with a reason.
--   4. Revision-limit bookkeeping columns on website_requests (limit 2).
--   5. notifications.href for deep links.
--   6. profiles.services (+ public_profiles mirror).
--   7. project_status: allow 'resubmitted' and 'payment_released', with the
--      matching transition_project_status() graph additions.
--
-- Everything is guarded (IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR
-- REPLACE) so the file can run once over a partially migrated database.

-- ==========================================================================
-- 1. select_project_proposal: record the agreed amount (BUG FIX)
-- ==========================================================================
-- createProjectCheckout (src/lib/project-payment.functions.ts) requires
-- website_requests.agreed_amount > 0, but nothing ever wrote it, so project
-- checkout always threw "The project amount has not been agreed yet".
-- proposed_amount and agreed_amount are both major-unit NUMERIC(12,2)
-- (e.g. 150.00 = $150); the checkout applies the 85/15 breakdown and
-- converts to minor units itself. The function body below is the
-- 20261031120000 definition with only the website_requests UPDATE extended.
CREATE OR REPLACE FUNCTION public.select_project_proposal(p_request_id UUID, p_proposal_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.website_requests%ROWTYPE;
  v_proposal public.project_proposals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_request FROM public.website_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Website request not found';
  END IF;

  IF v_request.requester_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only the request owner can select a proposal';
  END IF;

  -- Mirror the claim guard: an already-taken request cannot be re-assigned.
  IF v_request.taken_by IS NOT NULL OR v_request.status <> 'open' THEN
    RAISE EXCEPTION 'Request is no longer open for selection';
  END IF;

  SELECT * INTO v_proposal FROM public.project_proposals
  WHERE id = p_proposal_id AND request_id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found for this request';
  END IF;

  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'Proposal is not pending';
  END IF;

  IF v_proposal.developer_id = v_request.requester_id THEN
    RAISE EXCEPTION 'A requester cannot be selected for their own request';
  END IF;

  -- Reject the other pending proposals first so the one-accepted partial
  -- unique index can never be violated mid-flight.
  UPDATE public.project_proposals
  SET status = 'rejected', updated_at = now()
  WHERE request_id = p_request_id AND status = 'pending' AND id <> p_proposal_id;

  UPDATE public.project_proposals
  SET status = 'accepted', updated_at = now()
  WHERE id = p_proposal_id;

  UPDATE public.website_requests
  SET status = 'taken',
      taken_by = v_proposal.developer_id,
      taken_at = now(),
      selected_proposal_id = p_proposal_id,
      project_status = 'developer_selected',
      -- Agreed price = the accepted proposal's amount (major units). The
      -- platform is USD-only (20261028010000), so the agreed currency is
      -- stamped 'USD' rather than trusting the proposal row's currency.
      agreed_amount = v_proposal.proposed_amount,
      agreed_currency = 'USD',
      is_draft = false,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.select_project_proposal(UUID, UUID) TO authenticated;

-- ==========================================================================
-- 2. Notifications deep links (needed by the DM notification trigger below)
-- ==========================================================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS href TEXT;

-- ==========================================================================
-- 3. Direct messages on the dormant conversations/messages schema
-- ==========================================================================
-- conversations.last_message_at already exists (20260926090000); the ADD
-- COLUMN is a guarded no-op that documents the dependency.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- One general (listing-less) conversation per user pair. The table's
-- UNIQUE(listing_id, buyer_id, seller_id) cannot enforce this because
-- Postgres treats NULL listing_id values as distinct, and the pair could
-- be stored in either direction — so the index is on the normalised
-- (least, greatest) pair, restricted to listing_id IS NULL rows. Listing
-- enquiry threads keep their existing uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_general_pair_unique
  ON public.conversations (LEAST(buyer_id, seller_id), GREATEST(buyer_id, seller_id))
  WHERE listing_id IS NULL;

-- Keep conversations.last_message_at current on every message.
CREATE OR REPLACE FUNCTION public.touch_conversation_last_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_touch_conversation_last_message ON public.messages;
CREATE TRIGGER trg_touch_conversation_last_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_last_message();

-- Notify the other participant of a new direct message (same trigger
-- pattern as the project notifications in Waves C/D, plus the new href).
CREATE OR REPLACE FUNCTION public.notify_direct_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recipient UUID;
  v_sender_name TEXT;
BEGIN
  SELECT CASE WHEN buyer_id = NEW.sender_id THEN seller_id ELSE buyer_id END
    INTO v_recipient
  FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_recipient IS NOT NULL AND v_recipient <> NEW.sender_id THEN
    SELECT display_name INTO v_sender_name
    FROM public.profiles WHERE id = NEW.sender_id;
    INSERT INTO public.notifications (user_id, title, body, href)
    VALUES (v_recipient, 'New message',
            'You have a new message from ' ||
              COALESCE(NULLIF(v_sender_name, ''), 'a NORDEVA member') || '.',
            '/messages/' || NEW.conversation_id::text);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_direct_message ON public.messages;
CREATE TRIGGER trg_notify_direct_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_direct_message();

-- --------------------------------------------------------------------------
-- user_blocks: a user manages only their own block list; either party can
-- read the pair row so clients can show "blocked / you blocked them".
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_no_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx
  ON public.user_blocks (blocked_id);
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;
DROP POLICY IF EXISTS "users read own block pairs" ON public.user_blocks;
CREATE POLICY "users read own block pairs" ON public.user_blocks
  FOR SELECT TO authenticated
  USING (auth.uid() = blocker_id OR auth.uid() = blocked_id);
DROP POLICY IF EXISTS "users block others" ON public.user_blocks;
CREATE POLICY "users block others" ON public.user_blocks
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = blocker_id);
DROP POLICY IF EXISTS "users unblock others" ON public.user_blocks;
CREATE POLICY "users unblock others" ON public.user_blocks
  FOR DELETE TO authenticated
  USING (auth.uid() = blocker_id);

-- Enforcement: a message insert fails when a block exists in either
-- direction between the sender and the other conversation participant.
CREATE OR REPLACE FUNCTION public.block_dm_when_blocked()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_other UUID;
BEGIN
  SELECT CASE WHEN buyer_id = NEW.sender_id THEN seller_id ELSE buyer_id END
    INTO v_other
  FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_other IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = NEW.sender_id AND blocked_id = v_other)
       OR (blocker_id = v_other AND blocked_id = NEW.sender_id)
  ) THEN
    RAISE EXCEPTION 'Messages are blocked between you and this user';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_block_dm_when_blocked ON public.messages;
CREATE TRIGGER trg_block_dm_when_blocked
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.block_dm_when_blocked();

-- --------------------------------------------------------------------------
-- reports: allow reporting a profile or a message, not just a listing.
-- listing_id becomes nullable and a CHECK keeps exactly one target set,
-- so existing listing reports keep working unchanged.
-- --------------------------------------------------------------------------
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS reported_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;
ALTER TABLE public.reports
  ALTER COLUMN listing_id DROP NOT NULL;
ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_single_target_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_single_target_check
  CHECK (
    (listing_id IS NOT NULL)::int
    + (reported_user_id IS NOT NULL)::int
    + (message_id IS NOT NULL)::int
    = 1
  );
CREATE INDEX IF NOT EXISTS reports_reported_user_idx
  ON public.reports (reported_user_id) WHERE reported_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reports_message_idx
  ON public.reports (message_id) WHERE message_id IS NOT NULL;

-- ==========================================================================
-- 4. project_disputes: a reviewable dispute record (reason + resolution)
-- ==========================================================================
-- Raising a dispute still flips the project to 'disputed' via
-- transition_project_status (M4 wires the UI); this table is the record an
-- admin reviews. No notification trigger here — that lands with M4/M6.
CREATE TABLE IF NOT EXISTS public.project_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  raised_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  admin_note TEXT,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_disputes_status_check
    CHECK (status IN ('open', 'resolved_buyer', 'resolved_developer', 'resolved_partial', 'closed'))
);
CREATE INDEX IF NOT EXISTS project_disputes_project_idx
  ON public.project_disputes (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_disputes_status_idx
  ON public.project_disputes (status, created_at DESC);
ALTER TABLE public.project_disputes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.project_disputes TO authenticated;
GRANT ALL ON public.project_disputes TO service_role;
DROP POLICY IF EXISTS "project participants read disputes" ON public.project_disputes;
CREATE POLICY "project participants read disputes" ON public.project_disputes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = project_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "project participants raise disputes" ON public.project_disputes;
CREATE POLICY "project participants raise disputes" ON public.project_disputes
  FOR INSERT TO authenticated
  WITH CHECK (
    raised_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = project_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "admins update disputes" ON public.project_disputes;
CREATE POLICY "admins update disputes" ON public.project_disputes
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS update_project_disputes_updated_at ON public.project_disputes;
CREATE TRIGGER update_project_disputes_updated_at
  BEFORE UPDATE ON public.project_disputes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==========================================================================
-- 5. Revision limit bookkeeping (enforcement lands in M4)
-- ==========================================================================
ALTER TABLE public.website_requests
  ADD COLUMN IF NOT EXISTS revision_limit INT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS revisions_used INT NOT NULL DEFAULT 0;

-- ==========================================================================
-- 6. profiles.services + public_profiles mirror (Wave B pattern)
-- ==========================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS services TEXT[] DEFAULT '{}';
ALTER TABLE public.public_profiles
  ADD COLUMN IF NOT EXISTS services TEXT[] DEFAULT '{}';

-- Backfill from profiles for existing rows.
UPDATE public.public_profiles pp
SET services = COALESCE(p.services, '{}')
FROM public.profiles p
WHERE pp.id = p.id;

-- The Wave B sync function, extended with the services column.
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
    availability, hourly_rate, services, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.display_name, NEW.username, NEW.avatar_url, NEW.bio, NEW.website_url,
    NEW.twitter_url, NEW.github_url,
    NEW.headline, NEW.cover_url, COALESCE(NEW.skills, '{}'), COALESCE(NEW.languages, '{}'),
    NEW.experience_level, NEW.years_experience, NEW.availability, NEW.hourly_rate,
    COALESCE(NEW.services, '{}'), NEW.created_at, now()
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
    services = EXCLUDED.services,
    updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_public_profile() FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- 7. Statuses: 'resubmitted' and 'payment_released'
-- ==========================================================================
-- Transition-graph choice (kept minimal):
--   * revision_requested -> resubmitted: when the developer submits a new
--     delivery after a revision was requested, M4 moves the project to
--     'resubmitted' (same developer-only role rule as the other submission
--     states) instead of jumping straight back to a review state.
--   * resubmitted -> preview_submitted / final_submitted: from there the
--     project re-enters the existing review flow unchanged
--     (resubmitted -> disputed is also allowed, like every work state).
--   * completed -> payment_released: an admin-only marker that the manual
--     payout for a completed project has been settled (M5); the legacy
--     status column stays 'completed'.
ALTER TABLE public.website_requests
  DROP CONSTRAINT IF EXISTS website_requests_project_status_check;
ALTER TABLE public.website_requests
  ADD CONSTRAINT website_requests_project_status_check
  CHECK (project_status IS NULL OR project_status IN (
    'draft', 'pending_review', 'open', 'proposals_received',
    'developer_selected', 'awaiting_agreement', 'awaiting_payment',
    'in_progress', 'preview_submitted', 'revision_requested',
    'final_submitted', 'completed', 'cancelled', 'disputed', 'refunded',
    'resubmitted', 'payment_released'
  ));

-- The 20261031120000 transition function with only the graph/role deltas
-- described above (plus 'resubmitted' in the legacy-status sync list).
CREATE OR REPLACE FUNCTION public.transition_project_status(p_request_id UUID, p_status TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.website_requests%ROWTYPE;
  v_from TEXT;
  v_is_admin BOOLEAN;
  v_is_requester BOOLEAN;
  v_is_developer BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_status NOT IN (
    'draft', 'pending_review', 'open', 'proposals_received',
    'developer_selected', 'awaiting_agreement', 'awaiting_payment',
    'in_progress', 'preview_submitted', 'revision_requested',
    'final_submitted', 'completed', 'cancelled', 'disputed', 'refunded',
    'resubmitted', 'payment_released'
  ) THEN
    RAISE EXCEPTION 'Unknown project status: %', p_status;
  END IF;

  SELECT * INTO v_request FROM public.website_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Website request not found';
  END IF;

  v_is_admin := public.has_role(auth.uid(), 'admin');
  v_is_requester := v_request.requester_id = auth.uid();
  v_is_developer := v_request.taken_by IS NOT NULL AND v_request.taken_by = auth.uid();

  IF NOT (v_is_admin OR v_is_requester OR v_is_developer) THEN
    RAISE EXCEPTION 'Only project participants can change the project status';
  END IF;

  -- Effective current state: project_status when set, else derive from the
  -- legacy status used by rows created before this migration.
  v_from := COALESCE(v_request.project_status, CASE v_request.status
    WHEN 'open' THEN 'open'
    WHEN 'taken' THEN 'in_progress'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
  END);

  IF v_from = p_status THEN
    RETURN true; -- already there; idempotent no-op
  END IF;

  -- Allowed transition graph.
  IF NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('draft', 'pending_review'), ('draft', 'open'), ('draft', 'cancelled'),
      ('pending_review', 'open'), ('pending_review', 'draft'), ('pending_review', 'cancelled'),
      ('open', 'proposals_received'), ('open', 'developer_selected'), ('open', 'cancelled'),
      ('proposals_received', 'developer_selected'), ('proposals_received', 'open'), ('proposals_received', 'cancelled'),
      ('developer_selected', 'awaiting_agreement'), ('developer_selected', 'awaiting_payment'),
      ('developer_selected', 'in_progress'), ('developer_selected', 'cancelled'), ('developer_selected', 'disputed'),
      ('awaiting_agreement', 'awaiting_payment'), ('awaiting_agreement', 'in_progress'),
      ('awaiting_agreement', 'cancelled'), ('awaiting_agreement', 'disputed'),
      ('awaiting_payment', 'in_progress'), ('awaiting_payment', 'cancelled'), ('awaiting_payment', 'disputed'),
      ('in_progress', 'preview_submitted'), ('in_progress', 'final_submitted'),
      ('in_progress', 'cancelled'), ('in_progress', 'disputed'),
      ('preview_submitted', 'revision_requested'), ('preview_submitted', 'in_progress'),
      ('preview_submitted', 'final_submitted'), ('preview_submitted', 'disputed'),
      ('revision_requested', 'in_progress'), ('revision_requested', 'preview_submitted'), ('revision_requested', 'disputed'),
      ('revision_requested', 'resubmitted'),
      ('resubmitted', 'preview_submitted'), ('resubmitted', 'final_submitted'), ('resubmitted', 'disputed'),
      ('final_submitted', 'completed'), ('final_submitted', 'revision_requested'), ('final_submitted', 'disputed'),
      ('completed', 'disputed'), ('completed', 'refunded'), ('completed', 'payment_released'),
      ('disputed', 'in_progress'), ('disputed', 'completed'), ('disputed', 'cancelled'), ('disputed', 'refunded')
    ) AS t(f, tt)
    WHERE t.f = v_from AND t.tt = p_status
  ) THEN
    RAISE EXCEPTION 'Project status transition % -> % is not allowed', v_from, p_status;
  END IF;

  -- Role rules on top of the graph.
  IF p_status = 'refunded' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only an admin can mark a project refunded';
  END IF;
  IF p_status = 'payment_released' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only an admin can mark a project payment as released';
  END IF;
  IF p_status = 'cancelled' AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can cancel a project';
  END IF;
  IF p_status = 'completed' AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can approve completion';
  END IF;
  IF p_status = 'revision_requested' AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can request a revision';
  END IF;
  IF p_status IN ('preview_submitted', 'final_submitted', 'resubmitted') AND NOT (v_is_admin OR v_is_developer) THEN
    RAISE EXCEPTION 'Only the assigned developer can submit work';
  END IF;
  IF p_status IN ('draft', 'pending_review', 'open', 'proposals_received',
                  'awaiting_agreement', 'awaiting_payment')
     AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can move the project through this stage';
  END IF;
  IF p_status = 'in_progress' AND NOT (v_is_admin OR v_is_developer OR (v_is_requester AND v_from = 'awaiting_payment')) THEN
    RAISE EXCEPTION 'Only the assigned developer can move the project into progress';
  END IF;

  UPDATE public.website_requests
  SET project_status = p_status,
      is_draft = (p_status = 'draft'),
      status = CASE
        WHEN p_status = 'completed' THEN 'completed'
        WHEN p_status = 'cancelled' THEN 'cancelled'
        WHEN taken_by IS NOT NULL AND p_status IN (
          'developer_selected', 'awaiting_agreement', 'awaiting_payment',
          'in_progress', 'preview_submitted', 'revision_requested', 'final_submitted',
          'resubmitted'
        ) THEN 'taken'
        WHEN p_status IN ('open', 'proposals_received', 'pending_review') THEN 'open'
        ELSE status
      END,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transition_project_status(UUID, TEXT) TO authenticated;


-- ===== 20261101130000_wave_m4_delivery_approval.sql =====
-- VELORA ecosystem upgrade — Wave M4 (additive only, data-preserving).
--
-- project_deliveries: record WHEN the buyer approved a delivery.
-- Approval was previously only inferable from the delivery's
-- status = 'approved' plus the parent request's updated_at; approved_at
-- stamps the exact moment the buyer accepted a preview or the final
-- delivery in the workspace (set by the workspace approve action).
-- Guarded so the file can run once over a partially migrated database.

ALTER TABLE public.project_deliveries
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;


-- ===== 20261101140000_wave_m6_notification_links.sql =====
-- VELORA ecosystem upgrade — Wave M6 (additive only, data-preserving).
--
-- Notification deep links for the project workflow:
--   * The six project notification trigger functions from Waves C/D are
--     redefined verbatim, with only the notifications INSERT extended to
--     carry href = '/projects/' || request_id (the column was added in
--     Wave M1, and the DM trigger there already fills it). The existing
--     triggers keep calling these functions by name, so no trigger
--     changes are needed for them.
--   * A NEW trigger on project_disputes (table added in Wave M1) notifies
--     the project participant who did not raise the dispute, plus every
--     admin (pointed at /admin) so disputes get reviewed.
--
-- Guarded (CREATE OR REPLACE / DROP TRIGGER IF EXISTS) so the file can
-- run once over a partially migrated database.

-- --------------------------------------------------------------------------
-- Proposal notifications (Wave C functions, href added)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_requester_new_proposal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_requester UUID;
BEGIN
  SELECT title, requester_id INTO v_title, v_requester
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_requester IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, href)
    VALUES (v_requester, 'New proposal received',
            'A developer sent a proposal for "' || COALESCE(v_title, 'your website request') || '".',
            '/projects/' || NEW.request_id::text);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_developer_proposal_decision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
BEGIN
  IF NEW.status NOT IN ('accepted', 'rejected') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT title INTO v_title FROM public.website_requests WHERE id = NEW.request_id;
  INSERT INTO public.notifications (user_id, title, body, href)
  VALUES (
    NEW.developer_id,
    CASE WHEN NEW.status = 'accepted' THEN 'Proposal accepted' ELSE 'Proposal rejected' END,
    CASE WHEN NEW.status = 'accepted'
      THEN 'Your proposal for "' || COALESCE(v_title, 'a website request') || '" was accepted. The project is now assigned to you.'
      ELSE 'Your proposal for "' || COALESCE(v_title, 'a website request') || '" was not selected this time.'
    END,
    '/projects/' || NEW.request_id::text
  );
  RETURN NEW;
END;
$$;

-- --------------------------------------------------------------------------
-- Workspace notifications (Wave D functions, href added)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_project_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_recipient UUID;
BEGIN
  SELECT title,
         CASE WHEN requester_id = NEW.sender_id THEN taken_by ELSE requester_id END
    INTO v_title, v_recipient
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_recipient IS NOT NULL AND v_recipient <> NEW.sender_id THEN
    INSERT INTO public.notifications (user_id, title, body, href)
    VALUES (v_recipient, 'New project message',
            'You have a new message in the workspace for "' || COALESCE(v_title, 'your website project') || '".',
            '/projects/' || NEW.request_id::text);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_delivery_submitted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_requester UUID;
BEGIN
  SELECT title, requester_id INTO v_title, v_requester
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_requester IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, href)
    VALUES (
      v_requester,
      CASE WHEN NEW.kind = 'final' THEN 'Final delivery submitted' ELSE 'Preview submitted' END,
      CASE WHEN NEW.kind = 'final'
        THEN 'The final delivery for "' || COALESCE(v_title, 'your website project') || '" is ready for your review.'
        ELSE 'A new preview (version ' || NEW.version || ') for "' || COALESCE(v_title, 'your website project') || '" is ready for your review.'
      END,
      '/projects/' || NEW.request_id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_revision_requested()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_developer UUID;
BEGIN
  SELECT title, taken_by INTO v_title, v_developer
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_developer IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, href)
    VALUES (v_developer, 'Revision requested',
            'The client requested a revision on "' || COALESCE(v_title, 'your website project') || '".',
            '/projects/' || NEW.request_id::text);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_delivery_approved()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT title INTO v_title FROM public.website_requests WHERE id = NEW.request_id;
  INSERT INTO public.notifications (user_id, title, body, href)
  VALUES (
    NEW.submitted_by,
    'Delivery approved',
    'Your ' || NEW.kind || ' delivery (version ' || NEW.version || ') for "' ||
      COALESCE(v_title, 'a website project') || '" was approved.',
    '/projects/' || NEW.request_id::text
  );
  RETURN NEW;
END;
$$;

-- --------------------------------------------------------------------------
-- Dispute notifications (NEW — project_disputes arrived in Wave M1 with
-- no notification trigger). The participant who did not raise the dispute
-- is pointed at the workspace; every admin is pointed at /admin. An admin
-- who is already the notified participant is not double-notified, and the
-- person who raised the dispute is never notified about their own action.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_project_dispute()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_requester UUID;
  v_developer UUID;
  v_other UUID;
BEGIN
  SELECT title, requester_id, taken_by INTO v_title, v_requester, v_developer
  FROM public.website_requests WHERE id = NEW.project_id;

  v_other := CASE WHEN NEW.raised_by = v_requester THEN v_developer ELSE v_requester END;
  IF v_other IS NOT NULL AND v_other <> NEW.raised_by THEN
    INSERT INTO public.notifications (user_id, title, body, href)
    VALUES (v_other, 'Dispute raised',
            'A dispute was raised on "' || COALESCE(v_title, 'your website project') || '".',
            '/projects/' || NEW.project_id::text);
  END IF;

  INSERT INTO public.notifications (user_id, title, body, href)
  SELECT ur.user_id, 'New project dispute',
         'New project dispute needs review: "' || COALESCE(v_title, 'a website project') || '".',
         '/admin'
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND ur.user_id <> NEW.raised_by
    AND ur.user_id IS DISTINCT FROM v_other;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_project_dispute ON public.project_disputes;
CREATE TRIGGER trg_notify_project_dispute
  AFTER INSERT ON public.project_disputes
  FOR EACH ROW EXECUTE FUNCTION public.notify_project_dispute();

-- ===== FIX (2026-11-01): has_role anon execute — public policies (categories, product variants) reference has_role(); without EXECUTE for anon, public reads fail with 42501 =====
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO anon;
