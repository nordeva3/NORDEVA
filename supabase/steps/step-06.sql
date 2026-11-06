-- ============================================================
-- NORDEVA setup - STEP 6 of 11
-- Is step ko poora copy karke Supabase SQL Editor me Run karo.
-- ============================================================

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
CREATE POLICY "listing media public read" ON storage.objects FOR SELECT USING (bucket_id='listing-media');
DROP POLICY IF EXISTS "listing media seller upload" ON storage.objects;
CREATE POLICY "listing media seller upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='listing-media' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "listing media seller update" ON storage.objects;
CREATE POLICY "listing media seller update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='listing-media' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id='listing-media' AND (storage.foldername(name))[1] = auth.uid()::text);
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
CREATE POLICY "seller verification read own" ON public.seller_verifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

REVOKE INSERT, UPDATE, DELETE ON public.seller_verification_documents FROM authenticated;
DROP POLICY IF EXISTS "verification docs owner admin" ON public.seller_verification_documents;
CREATE POLICY "verification docs read own" ON public.seller_verification_documents
  FOR SELECT TO authenticated
  USING (
    verification_id IN (SELECT id FROM public.seller_verifications WHERE user_id = auth.uid())
    OR public.has_role(auth.uid(),'admin')
  );

REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM authenticated;
DROP POLICY IF EXISTS "subscription owner" ON public.subscriptions;
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

-- 2026-11-02 owner decision: scan verdicts veto only (see migration 20261102130000)
-- Owner decision (2026-11-02): no malware scanner is configured, and requiring
-- a 'clean' verdict from a scanner that does not exist deadlocks ALL publishing.
-- Admin manual moderation is the publishing gate; scanner verdicts now act as a
-- veto only: an 'infected' verdict (the only bad verdict the worker writes)
-- blocks publication, queued/clean/absent scans do not.
CREATE OR REPLACE FUNCTION public.enforce_listing_moderation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asset_count INTEGER;
  detail_count INTEGER;
  infected_scan_count INTEGER;
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

    SELECT count(*) INTO infected_scan_count
      FROM public.malware_scans WHERE listing_id = NEW.id AND status = 'infected';
    IF infected_scan_count > 0 THEN
      RAISE EXCEPTION 'Listing cannot be published: a delivery asset failed its malware scan';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
