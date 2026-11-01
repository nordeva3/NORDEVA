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
