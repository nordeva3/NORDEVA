-- Security hardening: an order is proof of a completed payment.
-- Clients must never be able to manufacture completed orders directly.
REVOKE INSERT ON public.orders FROM anon, authenticated;
DROP POLICY IF EXISTS "anyone can create order" ON public.orders;
DROP POLICY IF EXISTS "buyers create own or anon orders" ON public.orders;

-- Keep order creation available only to trusted server-side payment/webhook code.
GRANT INSERT ON public.orders TO service_role;
