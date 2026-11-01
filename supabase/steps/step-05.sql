-- ============================================================
-- NORDEVA setup - STEP 5 of 11
-- Is step ko poora copy karke Supabase SQL Editor me Run karo.
-- ============================================================

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
CREATE POLICY "product details public read" ON public.listing_product_details FOR SELECT USING (true);
DROP POLICY IF EXISTS "product details seller manage" ON public.listing_product_details;
CREATE POLICY "product details seller manage" ON public.listing_product_details FOR ALL TO authenticated
  USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "listing media public read" ON public.listing_media;
CREATE POLICY "listing media public read" ON public.listing_media FOR SELECT USING (true);
DROP POLICY IF EXISTS "listing media seller manage" ON public.listing_media;
CREATE POLICY "listing media seller manage" ON public.listing_media FOR ALL TO authenticated
  USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "listing assets seller manage" ON public.listing_assets;
CREATE POLICY "listing assets seller manage" ON public.listing_assets FOR ALL TO authenticated
  USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "listing faq public read" ON public.listing_faq;
CREATE POLICY "listing faq public read" ON public.listing_faq FOR SELECT USING (true);
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
CREATE POLICY "public storefront read" ON public.storefront_settings FOR SELECT USING (is_public OR auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
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
