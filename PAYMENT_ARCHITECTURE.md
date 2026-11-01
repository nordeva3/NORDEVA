# VELORA Global Payments Architecture

## Commission

- Platform commission: **15%**.
- Seller earnings: **85%** of the authoritative sale amount before separate processor/tax/payout costs.
- Commission is enforced in PostgreSQL, not trusted from browser input.
- Product variant/tier price is used when a variant is selected.

## Providers

### Razorpay

Use when the merchant account has international/multi-currency capability enabled.

- Checkout: `/checkout/$id`
- Webhook: `/api/razorpay-webhook`

### Stripe Checkout

Use for a US-based marketplace platform when Stripe is the configured provider.

- Hosted Checkout session is created server-side.
- Webhook: `/api/stripe-webhook`
- Orders are created only after a verified `checkout.session.completed` event with `payment_status=paid`.

## Security invariants

1. Browser never supplies platform fee, seller earnings, order amount, seller ID or currency as authoritative financial values.
2. Browser cannot directly insert orders through Supabase.
3. Provider webhook signatures are verified before processing.
4. Provider payment/order IDs are unique to make retries idempotent.
5. Variant price/currency is checked against the listing.
6. Paid delivery remains private and entitlement-controlled.
7. Secret keys are server-only.

## Launch requirement

Real provider accounts, KYC, tax/business verification, webhook delivery, refund/chargeback handling and seller payout rails must be tested in staging before live money is accepted.
