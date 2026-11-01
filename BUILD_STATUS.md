# VELORA Marketplace — Production Complete 2.2

## Changes in this build

- Platform commission changed from 3% to **15%** everywhere user-facing and in the authoritative PostgreSQL order-financial trigger.
- Variant/tier prices are now authoritative for order accounting; the base listing price can no longer overwrite a purchased variant price.
- Browser clients can no longer directly insert orders.
- Provider payment/order IDs have stronger uniqueness protection for webhook retries.
- Sellers cannot self-publish a listing; direct seller inserts/active updates are forced back to `pending`.
- Trusted publish actions require Product Studio details, cover media and at least one delivery asset.
- Product Studio validates tier prices/currencies before submission.
- Product uploads can request the protected malware-scan queue through a seller-safe RPC.
- Added optional global Stripe Checkout with signed webhook verification.
- Existing Razorpay international checkout remains supported.
- Added provider-aware launch health checks and global payment documentation.
- Updated README, workflow, production runbook and seller-facing commission copy.

## Validation performed

- TypeScript/TSX parser check: **0 parse errors** across `src/`.
- `package.json`: valid JSON.
- SQL migration order verified by timestamps.
- No `.env` secrets are included in the release ZIP.

## External production tests still required

A local static check cannot execute real money movement. Before live launch, test:

- Supabase RLS and private Storage from buyer/seller/admin accounts.
- Stripe or Razorpay test payment and webhook delivery.
- Duplicate webhook delivery.
- Variant/tier purchase and exact currency/amount.
- Refund/chargeback workflow.
- Seller payout rail and KYC.
- Malware scanner worker and email provider.
- Mobile browsers and signed downloads.
