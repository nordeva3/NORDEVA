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
CREATE POLICY "variants public read" ON public.product_variants FOR SELECT USING (active OR auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));
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
CREATE POLICY "coupon owner manages" ON public.coupons FOR ALL TO authenticated USING (seller_id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (seller_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
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
CREATE POLICY "product updates readable" ON public.product_updates FOR SELECT USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(), 'admin') OR EXISTS (SELECT 1 FROM public.orders o WHERE o.listing_id = product_updates.listing_id AND o.buyer_id = auth.uid() AND o.status = 'completed'));
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
CREATE POLICY "questions readable" ON public.product_questions FOR SELECT USING (true);
DROP POLICY IF EXISTS "buyers ask questions" ON public.product_questions;
CREATE POLICY "buyers ask questions" ON public.product_questions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
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
CREATE POLICY "conversation members" ON public.conversations FOR ALL TO authenticated USING (auth.uid() IN (buyer_id,seller_id) OR public.has_role(auth.uid(),'admin')) WITH CHECK (auth.uid() IN (buyer_id,seller_id) OR public.has_role(auth.uid(),'admin'));
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
CREATE POLICY "ticket participants" ON public.support_tickets FOR ALL TO authenticated USING (user_id = auth.uid() OR assigned_to = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (user_id = auth.uid() OR assigned_to = auth.uid() OR public.has_role(auth.uid(),'admin'));
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
CREATE POLICY "affiliate program owner" ON public.affiliate_programs FOR ALL TO authenticated USING (seller_id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (seller_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
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
CREATE POLICY "analytics insert" ON public.analytics_events FOR INSERT TO anon, authenticated WITH CHECK (user_id IS NULL OR user_id = auth.uid());
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
CREATE POLICY "public collections readable" ON public.collections FOR SELECT USING (visibility = 'public' OR owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "collection owner manages" ON public.collections;
CREATE POLICY "collection owner manages" ON public.collections FOR ALL TO authenticated USING (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "collection items readable" ON public.collection_items;
CREATE POLICY "collection items readable" ON public.collection_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.collections c WHERE c.id = collection_id AND (c.visibility='public' OR c.owner_id=auth.uid() OR public.has_role(auth.uid(),'admin'))));
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
