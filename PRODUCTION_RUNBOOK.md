# VELORA 2.0 Production Runbook

This build keeps the existing payment-provider implementation untouched by request. Payment verification/order creation remains a separate integration step.

## 1. Install

```bash
npm install
npm run dev
```

## 2. Environment

Copy `.env.example` to `.env` and set Supabase variables. Keep all service secrets server-side.

## 3. Supabase

Apply every migration in `supabase/migrations` in timestamp order. The final migration is:

`20260918050000_production_hardening.sql`

It adds:

- public/private profile separation (`public_profiles`)
- request-board contact privacy
- atomic request claim/complete functions
- payout-method ownership enforcement
- payout processing notes/reference
- refund/dispute workflow
- admin audit log
- server-backed newsletter subscriptions
- product asset validation
- automatic admin bootstrap for `nebulasoftwareplat@gmail.com`

## 4. Storage

Create private buckets:

- `listing-files`
- `request-photos`

Product files are intended to remain private and be served with short-lived signed URLs after authorization.

Request photos are readable only by request participants/admins after the hardening migration.

## 5. Admin

The owner account is automatically assigned the `admin` role when its email is exactly:

`nebulasoftwareplat@gmail.com`

If that account already existed before the final migration, the migration seeds the role immediately. If it is created later, the signup trigger assigns the role automatically.

## 6. Refunds

`/refunds` is now a real dispute-recording workflow. It does not perform payment-provider refunds. Admins can review, approve, reject, or resolve requests from the dashboard. Provider-side money movement remains intentionally separate.

## 7. Payouts

Payout requests remain manually processed. Admins should record a transfer/reference ID before marking a payout paid.

## 8. AI

VELORA AI now has request-size limits and a lightweight per-IP rate limit. For horizontally scaled production, add an external/shared rate limiter at the edge.

## 9. SEO

`/robots.txt` and `/sitemap.xml` are served dynamically from the configured `VITE_APP_URL` (or the request origin); no placeholder domain is committed.

## 10. QA

Run:

```bash
npm run lint
npm run build
```

Then manually test:

- signup/login/logout
- public browse/search
- creator profile
- seller listing submission
- admin moderation
- request posting/claim/completion
- private request photos
- wishlist/cart
- purchases/download authorization
- review create/update/helpful
- earnings/payout request
- refund/dispute request
- notifications
- newsletter subscription
- mobile navigation

Do not claim a payment is production-ready until the separate payment integration is tested against the real provider sandbox/live environment.
