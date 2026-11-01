# VELORA 2.4 Launch Checklist

## A. Database

- Confirm the VELORA USD-only migration is applied; manually review any legacy non-USD listings before republishing.
- Do not advertise every-country payments: verify buyer and seller country eligibility with the configured payment provider and local compliance requirements.
- Apply every migration in `supabase/migrations/` to a fresh staging project.
- Confirm the `listings.seller_id -> public_profiles.id` relationship exists after migrations.
- Confirm Storage buckets: `listing-files` private and `listing-media` public.
- Confirm RLS is enabled on all marketplace tables.
- Confirm browser role cannot insert `orders`.

## B. Payments

### Stripe

- Create/enable the platform's Stripe Connect capabilities.
- Configure Connect onboarding for the countries you actually support.
- Set Stripe Checkout webhook to `/api/stripe-webhook`.
- Subscribe at minimum to checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, payment_intent.payment_failed, charge.refunded, charge.dispute.created.
- Store `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` only on the server.

### Razorpay

- Configure the merchant account for the currencies/payment methods actually offered.
- Set `/api/razorpay-webhook` and its signing secret.
- For seller payouts, use Razorpay Route linked accounts rather than storing raw bank details where possible.

## C. Workers

- Configure `EMAIL_PROVIDER_URL` and `EMAIL_PROVIDER_TOKEN` for a real transactional email API.
- Configure `MALWARE_SCANNER_URL` and `MALWARE_SCANNER_TOKEN` for a real scanning service.
- Set a long random `WORKER_SECRET`.
- Configure the SQL in `supabase/CRON_SETUP.sql` after deployment.

## D. Tax

Do not hard-code tax rates. Choose a real tax engine or provider for the countries where VELORA will have tax obligations, then map the provider result into `orders.tax_amount` and the buyer/seller tax records.

## E. Seller payouts

- Prefer Stripe Connect or Razorpay Route linked accounts.
- Verify seller onboarding/identity status before enabling payout.
- Test failed payouts, retries, refunds and disputes in sandbox/test mode.

## F. Marketplace QA

Test all of these in staging:

1. signup/login/password recovery
2. seller onboarding
3. product upload with cover/gallery/files
4. moderation pending -> approved -> update -> re-moderation
5. one-time purchase
6. variant purchase
7. coupon purchase
8. pay-what-you-want purchase
9. subscription + trial + cancellation
10. duplicate webhook delivery
11. refund
12. private download authorization
13. license issuance
14. product update notification
15. payout onboarding
16. payout failure/retry
17. support ticket
18. buyer/seller messaging
19. rate-limit abuse
20. malware-positive asset
21. email provider failure/retry
22. mobile browser checkout

## G. Before public launch

- Verify `VITE_APP_URL` is set to the real production origin; robots and sitemap are generated dynamically.
- Set `VITE_APP_URL` to the real HTTPS origin.
- Set production auth redirect URLs in Supabase.
- Configure custom domain, HTTPS, CSP/security headers, backups and monitoring.
- Verify privacy/terms/refund/tax/legal documents for the actual operating entity.
