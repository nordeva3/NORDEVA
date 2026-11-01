# VELORA 2.0 production workflow

## 1. Comeback / QA

- Run the app on mobile and desktop.
- Confirm auth, browse, product detail, cart, seller dashboard and purchases.
- Fix broken flows before adding growth features.
- Keep user-facing errors short and actionable; do not show internal stack traces or debug/report dialogs.

## 2. Marketplace foundation

### Buyer

- Browse active listings only.
- Search/filter/category pages.
- Product detail, seller profile, reviews.
- Wishlist/cart.
- Secure checkout.
- Purchases + signed downloads.
- Private delivery unlocked only for seller or completed buyer.

### Seller

- Create account/profile.
- Upload listing and deliverable.
- Private delivery notes/files.
- Listing moderation status.
- Sales dashboard and earnings.
- Payout method + payout request.

### Admin

- Listing moderation.
- User overview.
- Marketplace report resolution.
- Payout queue.
- Order/commission tracking.

## 3. Payment flow — global providers

1. Buyer opens `/checkout/:id`.
2. Server verifies the listing is active, correctly priced, not already owned, and the selected variant matches the listing currency.
3. `PAYMENT_PROVIDER=auto` prefers Stripe when `STRIPE_SECRET_KEY` is configured; otherwise Razorpay is used.
4. Stripe uses hosted Checkout; Razorpay uses Checkout.js.
5. The browser never supplies the authoritative order amount, seller, currency, or platform fee.
6. Stripe `/api/stripe-webhook` or Razorpay `/api/razorpay-webhook` independently verifies provider events.
7. Only a verified paid/captured transaction with the exact listing/variant amount and currency can create the VELORA order.
8. Supabase trigger calculates the 15% platform fee and seller earnings from the authoritative listing/variant price.
9. Seller notification is created by the database trigger.
10. Buyer sees the purchase and can receive a short-lived signed download URL.

## 4. Money rules

- Platform fee: 15%.
- Order financial fields are recalculated by the database trigger.
- Client cannot insert completed orders.
- Duplicate provider payment IDs are rejected by a unique index.
- Payout requests cannot exceed available seller balance.

## 5. Production environment

Set these server variables:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYMENT_PROVIDER=auto|stripe|razorpay`
- `STRIPE_SECRET_KEY` (if using Stripe)
- `STRIPE_WEBHOOK_SECRET` (if using Stripe)
- `RAZORPAY_KEY_ID` (if using Razorpay)
- `RAZORPAY_KEY_SECRET` (if using Razorpay)
- `RAZORPAY_WEBHOOK_SECRET` (if using Razorpay)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Configure the active provider webhook URL:

- Stripe: `https://YOUR-DOMAIN/api/stripe-webhook` → `checkout.session.completed`
- Razorpay: `https://YOUR-DOMAIN/api/razorpay-webhook` → `payment.captured`, `order.paid`

Apply all Supabase migrations before going live.

## 6. Launch checklist

- Professional domain and HTTPS.
- Production Supabase project.
- Storage bucket `listing-files` configured as private.
- Supabase backups enabled.
- Active payment provider live credentials configured.
- Matching webhook secret configured and tested.
- Admin user role assigned.
- At least 10 sellers and 25 products for initial supply testing.
- Test one real low-value payment end-to-end before marketing.
- Test refund/support process separately.
- Verify mobile checkout and signed downloads.
