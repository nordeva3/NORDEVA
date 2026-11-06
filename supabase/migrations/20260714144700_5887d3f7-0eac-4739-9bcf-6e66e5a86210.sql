
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

-- QA fix (2026-11-02): 20260714144724 ne has_role ki execute ijaazat sabse chheen li thi; seller uploads band ho gaye the. Anon pehle theek hua, ye baaki roles ke liye hai.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
