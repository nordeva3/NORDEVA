# VELORA Marketplace — Completion & Launch Runbook

This build adds the code-side marketplace completion layer: a Marketplace OS workspace, storefront settings, production integration adapters, webhook audit logging, moderation history, a launch checker, light/dark theme support, stronger discovery indexes, and optional automated RazorpayX payouts / Razorpay refunds, 15% platform commission, variant-safe order accounting, and an optional Stripe Checkout global-payment path.

## What is now covered

### Buyer

- Marketplace browse/search/filter/sort
- Product detail, creator pages, reviews, wishlist, cart and checkout
- Private delivery + signed downloads
- Purchases, refund/dispute requests, notifications
- Product Q&A, conversations, support tickets
- Multi-currency product pricing and locale-aware money formatting
- Product variants/tier data model
- Subscription data model
- License-key data model
- Gift-card data model + transaction ledger
- Collections and saved discovery

### Seller

- Product Studio with moderation checklist
- Product media/assets/version/changelog data
- Seller dashboard + earnings + payout requests
- Coupons and variants
- Seller verification/KYC workflow
- Affiliate programme data model
- Tax profile and notification preferences
- API keys stored as SHA-256 hashes
- Public creator storefront settings
- Marketplace OS control center

### Admin / operations

- Product moderation + audit log
- Refund/dispute queue
- Payout queue
- User/report controls
- Moderation history per listing
- Webhook delivery audit table
- Optional provider refund execution
- Optional RazorpayX payout execution
- Launch readiness checker

### Security / reliability

- RLS remains the primary data boundary
- Private product files remain server-controlled
- Payment verification remains server-side
- Razorpay webhook signature verification remains mandatory
- Webhook deliveries are recorded with status/attempt metadata
- API keys are never stored in plaintext
- Server secrets are not exposed through `VITE_*`
- Production integration adapters fail closed when credentials are missing

## Required Supabase steps

1. Open **Supabase Dashboard → SQL Editor**.
2. Apply all project migrations in timestamp order.
3. Make sure these migrations are included:
   - `20260918050000_production_hardening.sql`
   - `20260926090000_global_marketplace_suite.sql`
   - `20260926100000_product_studio_admin.sql`
   - `20260926123000_marketplace_completion.sql`
   - `20260926140000_platform_fee_and_payment_hardening.sql`
   - `20260926143000_global_payment_provider.sql`
4. Create a **private** Storage bucket named `listing-files`.
5. Add Storage RLS policies so only the seller/admin can upload/manage an asset and only an entitled buyer can download it.
6. Never make the product delivery bucket public.

Supabase private buckets support RLS-controlled access and time-limited signed URLs; use signed URLs for paid downloads.

## Platform commission

VELORA now deducts a **15% platform commission** from each completed sale. Sellers receive **85% before any separate provider, tax, refund, or payout costs**. The database trigger is the authoritative calculation and also handles variant/tier prices.

## Global payment providers

The checkout supports **Razorpay** and an optional **Stripe Checkout** path. `PAYMENT_PROVIDER=auto` prefers Stripe when `STRIPE_SECRET_KEY` is configured; otherwise it uses Razorpay. Razorpay supports international payments for merchants whose accounts have the required capability enabled; Stripe Checkout is useful for a US-based marketplace platform and supports broad international presentment. Configure only providers actually enabled on the merchant account.

Stripe webhook endpoint: `/api/stripe-webhook`
Razorpay webhook endpoint: `/api/razorpay-webhook`

## Required server environment

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
PAYMENT_PROVIDER=auto
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
VITE_APP_URL=https://your-real-domain.example
```

Do not put service-role, Razorpay secret, webhook secret, email token, scanner token, or RazorpayX secret in a `VITE_*` variable.

## Optional production integrations

### RazorpayX seller payouts

Set:

```text
RAZORPAYX_KEY_ID=
RAZORPAYX_KEY_SECRET=
RAZORPAYX_ACCOUNT_NUMBER=
```

Then store a RazorpayX `provider_fund_account_id` against the seller payout method. Admins can use **Auto-pay** in the payout queue. The adapter sends an idempotency key derived from the VELORA payout ID.

Razorpay's current payout API requires an idempotency key and supports UPI/bank payout modes. Provider status should be reconciled through webhooks rather than treating an API submission as final settlement.

### Razorpay refunds

The admin refund queue now has a **Provider refund** action. It calls Razorpay's payment refund endpoint only after an admin has approved or moved the request to review.

### Transactional email

Set:

```text
EMAIL_PROVIDER_URL=
EMAIL_PROVIDER_TOKEN=
```

The database already contains an `email_outbox` queue. Connect a server worker/provider to claim queued rows, send the message, and update the row to `sent`/`failed`.

### Malware scanning

Set:

```text
MALWARE_SCANNER_URL=
MALWARE_SCANNER_TOKEN=
```

The database now contains `malware_scans`. Connect a scanning worker to inspect newly uploaded private assets before a listing can be approved. Do not auto-publish unrestricted seller files without an actual scanner.

## Launch checker

Open:

```text
/launch
```

It checks browser configuration, live Supabase connectivity, private `listing-files` storage, the public application URL and server-side Razorpay configuration through `/api/health`.

## Marketplace OS

Open:

```text
/marketplace-os
```

This is the operational workspace for commerce, storefront, support, growth, security and seller modules.

## Health endpoint

The server exposes:

```text
GET /api/health
```

It returns only non-secret integration presence flags and a timestamp.

## Payment flow

1. Server validates the listing, buyer, variant and currency.
2. The configured provider creates a server-side checkout/order.
3. Browser completes the hosted/provider checkout.
4. Server verifies the provider signature/webhook.
5. Server fetches or receives the provider payment confirmation.
6. Server captures an authorized Razorpay payment when required.
7. Server verifies exact amount/currency/order/payment IDs.
8. Database calculates the 15% commission from the authoritative product/tier price.
9. Server creates the order only after verified payment.
10. Webhook handling is signature-verified and idempotent.
11. Paid assets are delivered through private storage/signed access.

## Final production checks

- [ ] Production domain + HTTPS
- [ ] Supabase production project
- [ ] All migrations applied
- [ ] `listing-files` is private
- [ ] Storage RLS tested with buyer/seller/admin accounts
- [ ] Razorpay test payment completed
- [ ] Razorpay webhook received and recorded
- [ ] Duplicate webhook ignored safely
- [ ] Refund test completed
- [ ] Payout test completed in RazorpayX if automation is enabled
- [ ] Malware scan worker connected
- [ ] Email provider connected
- [ ] Backups enabled
- [ ] Error monitoring enabled
- [ ] Admin account verified
- [ ] Mobile checkout tested
- [ ] Signed download tested from a second device/session
- [ ] Seller verification flow tested
- [ ] Support ticket flow tested
- [ ] At least 10 real sellers and 25 real products before serious marketing

## Android / Termux note

The Supabase CLI package is not supported by Android/Termux in this environment. Apply migrations through the Supabase SQL Editor or from a supported desktop/CI environment instead of trying to run `npx supabase` locally on the phone.

## Important boundary

No codebase can honestly guarantee “zero bugs” before real production credentials, provider webhooks, storage policies, browser/device combinations, and real payment/refund/payout flows have been exercised. This build adds defensive validation and provider adapters, but those external systems still need a real staging test before live launch.
