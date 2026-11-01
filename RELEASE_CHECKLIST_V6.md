# VELORA v6 release checklist

## Build and quality

- [ ] `npm ci`
- [ ] `npm run build`
- [ ] `npm run lint`
- [ ] `npm run test:e2e`
- [ ] Test the production preview, not only the development server

## Database and security

- [ ] Apply new migrations in staging after backup
- [ ] Review Supabase Security Advisor and RLS policies
- [ ] Verify public profile fields contain no private data
- [ ] Verify only trusted staff/server paths can assign seller verification
- [ ] Confirm `pg_trgm` extension/index creation succeeded
- [ ] Test username collisions, unicode names, punctuation, long queries, and no-result searches

## Marketplace workflows

- [ ] Sign up, sign in, sign out, and password reset
- [ ] Search profiles, open profile, browse active listings
- [ ] Follow/unfollow, including signed-out and own-profile cases
- [ ] Seller listing creation/editing, moderation, and removal
- [ ] Checkout, payment webhook signature verification, refunds, and duplicate webhook idempotency
- [ ] Upload authorization, file size/type checks, and private asset access

## UX and deployment

- [ ] Mobile, tablet, desktop, keyboard, screen reader, reduced-motion and contrast checks
- [ ] Direct URL and browser refresh for every route
- [ ] HTTPS/domain, environment secrets, auth email, monitoring and backup restore test
- [ ] Privacy policy, terms, contact/support, and incident-response process reviewed
