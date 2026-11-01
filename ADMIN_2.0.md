# VELORA Admin 2.0

New route: `/admin`

## Sections

- Overview / marketplace health
- Product moderation
- Orders and platform fees
- Seller verification / KYC queue
- Customer support queue
- User management controls
- Reports / trust queue
- Analytics / UTM event activity
- Operations task board

All privileged mutations use server-side admin checks and write to the existing admin audit system.

## Database

The same Product Studio/Admin migration adds:

- `admin_tasks`
- `admin_user_controls`
- `seller_verification_documents`
- Product Studio metadata/media/assets/FAQ tables

## Provider limitations

The panel can record moderation, verification, support and payout/refund workflow state. Actual bank/provider payout and refund execution still requires a configured payment/payout provider integration; the panel does not pretend a manual status change transferred money.
