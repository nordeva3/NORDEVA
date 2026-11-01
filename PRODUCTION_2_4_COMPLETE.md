# VELORA Production 2.4 — Completion Pack

This release turns previously modeled marketplace modules into server-side production paths where they can be implemented without inventing provider credentials.

## Added

- Stripe Connect Express seller onboarding + account capability sync.
- Secure coupon validation/consumption RPCs.
- Order fields for discount/tax/gross/provider checkout metadata.
- Subscription checkout path using Stripe Billing Checkout.
- Durable public `listing-media` bucket for cover/gallery media; paid delivery stays private.
- Server-only email outbox worker endpoint with retry/backoff.
- Server-only malware scan worker endpoint with fail-closed listing rejection on an `infected` result.
- Server-side rate-limit bucket RPC for future/endpoint throttling.
- Gift-card redemption RPC with transactional balance decrement.
- Production CI workflow: install, lint, TypeScript check, Vite build.

## Provider setup still required

These are intentionally not fakeable in source code:

1. Stripe Connect platform account + marketplace approval/capabilities.
2. Stripe webhook URL + `STRIPE_WEBHOOK_SECRET`.
3. A real transactional email provider endpoint + token.
4. A real malware scanner endpoint + token.
5. `WORKER_SECRET` and a scheduler. Supabase Cron can call the worker endpoints.
6. Real tax rules/provider for the countries where VELORA will sell. The app must not invent tax rates.
7. Razorpay Route linked-account onboarding if Razorpay seller payouts are desired.
8. Legal/tax/business registrations required for the operator's actual jurisdiction.

## Important live verification

No source-only change can truthfully guarantee 100% production correctness. Before launch, run the supplied smoke/regression checklist against a staging Supabase project and sandbox payment accounts, then repeat with production webhooks and payout accounts.
