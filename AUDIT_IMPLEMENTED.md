# VELORA Production Audit — Implemented in This Build

## Implemented

- Public/private profile separation with `public_profiles`; public listing/creator/review queries no longer require the private profile email column.
- Request board now reads through a public projection that omits requester contact information.
- Request contact is fetched only through an authenticated server function for the requester/taker.
- Request claiming and completion use atomic database functions to avoid two users claiming the same open request.
- Request-photo reads are restricted to requester/taker/admin.
- Payout requests verify that the selected payout method belongs to the same seller.
- Payout requests store admin notes, processing time, and manual transfer/reference IDs.
- Refund/dispute records are persisted and visible to the buyer; admins can review/approve/reject/resolve from the dashboard.
- Admin actions are written to an audit log.
- Owner admin bootstrap is configured for `nebulasoftwareplat@gmail.com` both for an existing account and future sign-ups.
- Newsletter subscriptions are persisted server-side instead of browser-only localStorage.
- VELORA AI has request-size limits and a lightweight per-IP rate limit.
- Product asset validation prevents oversized files and product paths that do not belong to the seller upload folder.
- Listing URL/docs validation remains enforced at the database layer.
- Listing-view identity spoofing is blocked.
- SEO `robots.txt` and a starter sitemap are included.
- Production runbook is included.

## Intentionally not changed in this phase

- Existing Razorpay payment creation, verification, capture, and webhook implementation.
- Automated payment-provider refunds.
- Automated seller payouts.
- Malware scanning provider integration.
- External transactional email provider.
- External/shared rate limiting for multi-instance production.

These require external credentials/services and were left outside the requested payment phase.

## Verification note

The environment available for this build did not contain the project's installed npm dependencies, and `npm install` timed out. Therefore a full Vite build/browser run could not be completed here. Static TypeScript parsing was checked for the edited files; dependency-resolution errors are expected until `npm install` succeeds in the user's environment.
