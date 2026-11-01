-- VELORA marketplace upgrade — Wave F (additive only).
--
-- Project payments for the custom website projects marketplace:
--   * project_payments records one row per Stripe Checkout attempt for a
--     website request whose developer has been selected and whose amount
--     has been agreed (website_requests.agreed_amount / agreed_currency).
--   * The 85/15 split is computed server-side at checkout creation and
--     stored on the row (platform_fee + developer_amount = amount), so the
--     amounts shown to both parties and used for payout records can never
--     drift from what was actually charged.
--   * Rows are written ONLY by trusted server code (checkout creation and
--     the Stripe webhook, both via the service role). Authenticated users
--     get read-only access scoped to the project's two participants
--     (requester + assigned developer) and admins — the same participant
--     pattern the Wave A workspace tables use. There is deliberately no
--     client INSERT/UPDATE/DELETE grant or policy: a payment's status can
--     never be forged from the browser.
--   * Payout execution stays with the existing seller payout system
--     (payout_requests / admin payout queue). This table is the auditable
--     record of what the developer is owed for a project; no payout row is
--     auto-created here because payout_requests balances on /earnings are
--     computed from product orders, and an unlinked project row would
--     corrupt that math.

-- --------------------------------------------------------------------------
-- Project payments
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  payer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_session_id TEXT UNIQUE,
  provider_payment_intent TEXT,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  platform_fee NUMERIC(12,2) NOT NULL,
  developer_amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'disputed', 'partially_refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_payments_request_idx
  ON public.project_payments (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_payments_payment_intent_idx
  ON public.project_payments (provider_payment_intent)
  WHERE provider_payment_intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_payments_payee_idx
  ON public.project_payments (payee_id, created_at DESC);
ALTER TABLE public.project_payments ENABLE ROW LEVEL SECURITY;
-- Read-only for authenticated participants/admins (see policy below);
-- all writes are service-role only.
GRANT SELECT ON public.project_payments TO authenticated;
GRANT ALL ON public.project_payments TO service_role;
DROP POLICY IF EXISTS "project payment participants read" ON public.project_payments;
CREATE POLICY "project payment participants read" ON public.project_payments FOR SELECT
  TO authenticated
  USING (
    auth.uid() = payer_id
    OR auth.uid() = payee_id
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP TRIGGER IF EXISTS update_project_payments_updated_at ON public.project_payments;
CREATE TRIGGER update_project_payments_updated_at
  BEFORE UPDATE ON public.project_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
