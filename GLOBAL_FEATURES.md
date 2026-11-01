# VELORA Global Marketplace Suite

This build keeps the existing VELORA marketplace and adds an additive global commerce suite.

## Included in this build

- Expanded ISO-4217 currency catalogue and locale-aware money formatting.
- Razorpay checkout passes the listing currency instead of forcing INR.
- Correct minor-unit handling for zero-decimal currencies such as JPY/KRW.
- Password recovery + recovery-session password update.
- Product variants / tiers.
- Seller coupons and discount records.
- Gift-card data model.
- License-key data model with seats/revocation/expiry.
- Product update/changelog records.
- Product Q&A.
- Buyer/seller conversations and messages.
- Support tickets and support messages.
- Seller verification / KYC workflow records.
- Affiliate programs and referral records.
- Referral records.
- Analytics events with UTM/session/referrer fields.
- Seller API-key records (only a hash is stored).
- Subscription data model for provider-backed recurring billing.
- Notification preferences.
- Tax profile records.
- Public/private collections.
- Dashboard Marketplace Suite UI for the above seller controls.

## Payment-provider requirement

The application now sends the listing's ISO currency to Razorpay. The actual currencies/methods that can be charged depend on the Razorpay merchant account and its enabled international-payment capabilities. Razorpay currently advertises broad international currency coverage, but an application cannot force unsupported currencies on a merchant account.

## Verification status

The source ZIP was updated and statically checked. A full production "zero bugs / zero crashes" guarantee is not possible without deploying with real Supabase/Razorpay credentials and exercising the live browser, storage, webhook, refund, payout and international-payment flows. The package install/build could not be completed in this offline runtime because dependencies were unavailable.

## Apply the database changes

Run the new Supabase migration after the existing migrations:

`supabase/migrations/20260926090000_global_marketplace_suite.sql`

Then configure the server environment from `.env.example`, deploy, and test the payment-provider capabilities for each currency you intend to sell in.
