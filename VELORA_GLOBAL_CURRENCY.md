# VELORA global availability and USD pricing

- VELORA storefront prices, product tiers, request budgets, and checkout amounts use USD.
- USD pricing does not mean every country can transact. Availability depends on the payment provider's supported buyer/seller countries, merchant onboarding, sanctions/export controls, card network rules, local law, tax obligations, and payout rails.
- Stripe Connect and Razorpay are not universally available in every country. Do not claim worldwide payments until each target country is validated against the selected provider's current country list and compliance requirements.
- Configure `VITE_APP_URL`, Supabase auth redirect URLs, provider webhook URLs, tax provider, email provider, malware scanner, and worker secret before production.
- The USD migration blocks new/updated non-USD listing/variant/request prices. It deliberately does not silently rewrite legacy prices. Audit existing data before applying it; convert any historical non-USD price using an approved dated FX rate or keep that listing unavailable until manually reviewed.
- Before live launch, run `npm ci`, `npm run build`, `npm run lint`, `npm run test:e2e`, then apply migrations to a staging database and complete the full checklist in `PRODUCTION_LAUNCH_CHECKLIST.md`.
