-- Global payment provider support.
-- Stripe Checkout is optional; Razorpay remains supported for merchants who use it.
-- No payment secret is stored in the database.
CREATE INDEX IF NOT EXISTS webhook_deliveries_provider_status_idx
  ON public.webhook_deliveries(provider, status, received_at DESC);
