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
