# NORDEVA — Complete setup guide

Follow these steps in order. Nothing here is optional for a live site except
the items marked *(optional)*.

## 1. Your admin email — already set

The admin email in the migrations is set to **nebulasoftwareplat@gmail.com**
(3 places in `supabase/migrations/`). Whoever signs up with that email
automatically becomes the marketplace admin — so sign up with exactly that
email after deployment.

If you ever want a different admin email, change all 3 places **before**
applying the migrations; after the migrations run, the address in the
database trigger decides who gets admin on signup.

## 2. Supabase project

**Already have a project where the combined migrations were run before (e.g. the NORDEVA project created 2026-10-31)?** Run `supabase/CATCH_UP_MIGRATIONS.sql` once in the SQL Editor instead — that first run stopped partway, and this file safely applies everything that is missing (later original migrations + storage buckets + the marketplace upgrade: custom projects, proposals, workspace, professional profiles, categories, project payments). Every statement is guarded, so already-applied pieces are skipped and no data is deleted. (`supabase/UPGRADE_MIGRATIONS.sql` remains for projects whose original migrations fully applied.) Skip the rest of this section.

1. Create a project at supabase.com.
2. SQL Editor → run every file in `supabase/migrations/` in filename order.
   (Or with the Supabase CLI: `supabase link` then `supabase db push`, after
   setting your own project ref in `supabase/config.toml`.)
3. Storage → confirm the buckets exist and are **private**: `listing-files`,
   `listing-media`, `request-photos`. Buyers receive files only through
   signed, expiring download links.
4. Authentication → URL configuration → add your site URL and
   `https://your-domain/auth` as redirect URLs.
5. *(Optional, demo only)* After creating your account in the app, run
   `supabase/seed.sql` once to create sample listings, then approve them in
   `/admin`. Never run the seed on a production store you intend to open
   with real products.

## 3. Environment variables

Copy `.env.example` to `.env` and fill it in. Minimum to boot the site:

| Variable | Where to get it |
| --- | --- |
| `VITE_SUPABASE_URL`, `SUPABASE_URL` | Supabase → Settings → API |
| `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API — **server only, never in client code or a `VITE_` variable** |
| `VITE_APP_URL` | Your real domain, e.g. `https://nordeva.example.com` |

## 4. Payments (choose one to start)

**Razorpay (India):** set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`, and point the Razorpay webhook to
`https://your-domain/api/razorpay-webhook` (events: `payment.captured`,
`order.paid`). For automatic seller payouts also set the `RAZORPAYX_*`
variables.

**Stripe (US/international):** set `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `PAYMENT_PROVIDER=stripe`, and point the Stripe
webhook to `https://your-domain/api/stripe-webhook` (event:
`checkout.session.completed`).

The platform keeps **15%** of every sale; sellers receive 85% before
provider/payout costs. This is enforced in the database, not the browser.
Always run one real low-value test payment before marketing the site.

## 5. AI assistant *(optional)*

Set `GEMINI_API_KEY` to enable the built-in help assistant. Without it the
rest of the marketplace works normally; only the assistant is disabled.
Check the current Gemini model name in Google AI Studio and set
`GEMINI_MODEL` accordingly.

## 6. Email and file scanning *(optional but recommended)*

Set `EMAIL_PROVIDER_URL`/`EMAIL_PROVIDER_TOKEN` and
`MALWARE_SCANNER_URL`/`MALWARE_SCANNER_TOKEN` if you use those services,
generate a `WORKER_SECRET`, and schedule the two cron jobs described in
`supabase/CRON_SETUP.sql` (uncomment, replace the domain, run in SQL Editor).

## 7. Run it

```bash
# Node 22 (see .nvmrc)
npm ci
npm run build     # production build
npm run dev       # local development on http://localhost:3000
```

Verify before launch:

```bash
npx tsc --noEmit --skipLibCheck   # must report 0 errors
npm run build                      # must finish with "built"
npm run test:e2e                   # Playwright smoke tests (needs a running Supabase)
```

## 8. Deploy

Build the Docker image (`Dockerfile` in this project) or deploy the
repository to any Node 22 host that can run the built server
(`npm run preview` serves the production build). Set the same environment
variables on the host, attach your domain, and re-check `/launch` and
`/api/health` on the live site.

If the Supabase schema ever changes, regenerate the TypeScript types with
`python3 generate_supabase_types.py` (offline, from the migration files) or
`supabase gen types` against your live project, so `src/integrations/supabase/types.ts`
stays in sync.

## 9. Appearance (TITANIUM)

The site ships with the **TITANIUM** design preset as the default look
(graphite/silver, dark + light + system themes). An admin can switch the
site-wide preset, card variant, density and accent from the **Design** tab
in the admin panel — the earlier looks (Premium Dark and others) are still
there and fully supported. Individual visitors additionally control their
own theme, font size, corner radius, motion and density from the TopNav
Appearance settings; those choices are stored per device in the browser,
not in the database.
