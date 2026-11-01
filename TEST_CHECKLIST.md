# VELORA 2.0 test checklist

## Product Studio

1. Sign in and open `/sell`.
2. Choose Software or Website.
3. Upload cover + 3 screenshots.
4. Upload a ZIP and extra assets.
5. Add USD/INR/EUR/JPY and variant values.
6. Add technical, license, SEO, tax and legal fields.
7. Submit and confirm listing is `pending`.
8. Confirm files are private in the `listing-files` bucket.
9. Admin approves the listing from `/admin`.
10. Open the public listing and verify media/details.

## Admin 2.0

1. Non-admin user must not load admin data.
2. Admin can approve/reject pending listings.
3. Admin can verify/reject seller verification requests.
4. Admin can change support status.
5. Admin can restrict/suspend users.
6. Admin can review reports, orders and analytics.
7. Admin can create an operations task.
8. Audit log should record privileged actions.

## Payment

Run a sandbox Razorpay payment only after server credentials and supported currencies are configured. Verify amount/currency/signature/provider status server-side.

## Required production checks

- Supabase migrations applied
- Storage policies verified
- Malware scanner connected
- Email/notification provider configured
- Razorpay international currencies enabled where needed
- Tax/VAT/GST rules configured for the jurisdictions you operate in
- Browser/mobile E2E test completed
