# VELORA v6 — release hardening and verification report

## What changed in this package

- Refined the profile-discovery page copy and surface styling to use a restrained editorial marketplace aesthetic rather than excessive gradients/glows.
- Hardened profile search input before it is inserted into a PostgREST `.or(...)` expression and capped the query term length.
- Added trigram indexes for case-insensitive substring profile discovery; the existing B-tree indexes remain useful for ordering and equality-style access patterns.
- Changed follower count retrieval to a database-side exact count instead of downloading every follower row.
- Prevented self-follow from the UI and handled follow-delete errors before changing the displayed state.
- Added a Playwright smoke test for the people-discovery route.
- Added an additive SQL migration and a release checklist below.

## Verification status (honest)

- Source and SQL files were inspected in the extracted archive.
- The original archive was ZIP-tested before these edits; the final archive is ZIP-tested again after packaging.
- `npm ci --ignore-scripts --no-audit --no-fund` was attempted in the isolated build environment but timed out before dependencies were installed. Therefore this environment could **not** complete `npm run build`, ESLint, or Playwright. Do not treat this package as fully runtime-tested solely because it has been packaged.
- No Supabase project credentials were supplied, so migrations were **not** applied to a live database and RLS/trigger behaviour was not verified against your project data.
- A successful local production build, staging migration, browser tests, payment-provider tests, and security-advisor review are required before public launch.

## Apply migrations safely

1. Back up or create a staging Supabase project first.
2. Confirm the existing migrations have been applied in order and that `public.public_profiles` and `public.seller_verifications` exist.
3. Apply `20261028020000_marketplace_public_profiles_search_verified.sql` and then `20261028030000_marketplace_profile_search_performance.sql` in staging.
4. Confirm the `pg_trgm` extension is available. Review migration output for extension/schema permission errors.
5. Check that only trusted admin/server verification workflows can mark a seller as verified. A public badge must never be user-controlled.
6. Test `/people`, `/creator/<username>`, sign-in, follow/unfollow, listings, and empty/error states using real staging data.
7. In Supabase Security Advisor, verify RLS is enabled on all exposed tables and that public reads cannot reveal private seller or buyer data.

## Before public production

- Configure Supabase URL and publishable/anon key; keep service-role, payment secrets, webhook secrets, and other private credentials server-side only.
- Run `npm ci`, `npm run build`, `npm run lint`, and `npm run test:e2e` in a normal networked environment.
- Test direct URL loads and refreshes on all routes; test mobile viewport, keyboard-only navigation, focus visibility, reduced motion, and contrast.
- Verify listing ownership, order/payment status transitions, refunds, webhooks, payouts, upload permissions, rate limits, and abuse reporting in staging.
- Configure domain, HTTPS, auth email/SMTP, monitoring, backups, incident recovery, privacy/terms, and real support contact details.
- Do not launch payment/payout features until provider credentials, webhook signature verification, and reconciliation are validated.

## Scope note

“Professional-looking” is a design target, not a guarantee of being indistinguishable from a human-designed product. Production readiness also depends on credentials, database state, real browser/device testing, and payment/security configuration outside this ZIP.
