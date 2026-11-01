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
