
REVOKE EXECUTE ON FUNCTION public.enforce_order_financials() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_payout_balance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_listing_urls() FROM PUBLIC, anon, authenticated;
