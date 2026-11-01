
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
