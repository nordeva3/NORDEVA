-- VELORA demo seed (optional, for local/staging only — do NOT run in production
-- with these sample products live).
--
-- How to use:
--   1. Apply all migrations in supabase/migrations/ first.
--   2. Create at least one account in the app (Auth sign-up). That account
--      becomes the demo seller for the sample listings below.
--   3. Run this file once in the Supabase SQL Editor.
--
-- The listings are inserted for the FIRST registered user. They start in
-- 'pending' status like any real seller listing, so an admin still approves
-- them from /admin before they appear in the marketplace — exactly the real
-- flow. Delete them any time from the admin panel.

DO $$
DECLARE
  demo_seller uuid;
BEGIN
  SELECT id INTO demo_seller FROM auth.users ORDER BY created_at ASC LIMIT 1;
  IF demo_seller IS NULL THEN
    RAISE NOTICE 'VELORA seed skipped: no user exists yet. Sign up in the app first, then re-run seed.sql.';
    RETURN;
  END IF;

  INSERT INTO public.listings (seller_id, kind, title, description, category, price, currency, status)
  VALUES
    (demo_seller, 'software', 'InvoiceFlow — Billing dashboard for freelancers',
     'A complete invoicing dashboard: clients, invoices, payment tracking, PDF export and email reminders. Built with React and TypeScript, production-ready out of the box.',
     'Apps & Software', 49, 'USD', 'pending'),
    (demo_seller, 'website', 'Northwind — SaaS landing page template',
     'A conversion-focused landing page template with pricing, FAQ, testimonials and a working waitlist form. Responsive, accessible, and easy to rebrand.',
     'Websites & Templates', 29, 'USD', 'pending'),
    (demo_seller, 'software', 'SupportDesk AI — Customer support widget',
     'An embeddable support widget with a help centre, ticket inbox and AI-assisted reply drafts. Includes the full source code and setup guide.',
     'AI & Automation', 79, 'USD', 'pending'),
    (demo_seller, 'website', 'Atlas Portfolio — Photographer portfolio site',
     'A fast, image-first portfolio website with galleries, booking enquiries and a simple admin page. Ships with documentation and lifetime updates.',
     'Websites & Templates', 39, 'USD', 'pending'),
    (demo_seller, 'software', 'ChartKit Pro — React chart components',
     'A library of 24 polished, accessible chart components for dashboards: line, bar, funnel, heatmap and more, with dark-mode support.',
     'UI/UX & Design', 59, 'USD', 'pending'),
    (demo_seller, 'software', 'LaunchList — Waitlist and referral toolkit',
     'Collect emails before launch with referral tracking, fraud checks and CSV export. Self-hosted, no monthly fees.',
     'Apps & Software', 35, 'USD', 'pending')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'VELORA seed done: sample listings created for seller % (status: pending — approve them in /admin).', demo_seller;
END $$;
