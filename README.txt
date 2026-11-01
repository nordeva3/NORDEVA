NORDEVA MARKETPLACE — PRODUCTION BUILD

This package contains the NORDEVA 2.0 marketplace application with:
- Buyer marketplace and search
- Seller listings, delivery and earnings
- Admin moderation, reports and payout queue
- Supabase RLS and server-only order creation
- Global checkout with optional Stripe Checkout or Razorpay
- Signed/idempotent Stripe and Razorpay webhook verification
- 15% platform commission enforced by the database
- Private delivery and signed downloads
- Mobile-first premium UI

IMPORTANT PRODUCTION SETUP
1. Create/configure the Supabase project.
2. Apply every SQL migration in supabase/migrations.
3. Configure the private listing-files storage bucket.
4. Set the variables in .env.example.
5. Configure your active payment provider (Stripe for a US-based marketplace or Razorpay for an India-based merchant with international capability).
6. Configure the matching webhook endpoint: `/api/stripe-webhook` or `/api/razorpay-webhook`.
7. Create an admin role for the owner account.
8. Run a real low-value test payment before marketing.

The application deliberately does not create fake successful orders. A purchase exists only after server-side payment verification or a verified provider webhook.

The final production deployment still requires your own domain, hosting, Supabase project and payment credentials. Those cannot be safely embedded in this ZIP.

NORDEVA 2.0 HARDENED BUILD
- Payment layer hardened for a 15% commission, variant-safe accounting, and optional global Stripe Checkout.
- Added production hardening migration: public/private profiles, request privacy, payout ownership checks, refund/dispute records, admin audit logs, newsletter backend, asset validation, and owner-admin bootstrap.
- Added server-side AI request limiting.
- Added real newsletter persistence instead of localStorage-only signup.
- Added request claim/complete authorization helpers.
- Added robots.txt, sitemap.xml, and PRODUCTION_RUNBOOK.md.
- Replace YOUR-DOMAIN.example in public/robots.txt and public/sitemap.xml before launch.
