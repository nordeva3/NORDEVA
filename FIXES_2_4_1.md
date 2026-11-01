# VELORA 2.4.1 final hardening notes

This release adds:

- Chip/tag input in Product Studio with Enter/comma creation, remove, duplicate protection, keyboard navigation and suggestions.
- SEO keyword chips using the same accessible tag control.
- Catalog search autocomplete for products, categories, tags and popular submitted queries.
- Keyboard-accessible combobox/listbox behavior for search and tags.
- Search-by-tag/category support in marketplace browse.
- Server-side tag normalization and limits.
- Server-authoritative seller payment accounts, verification state and subscriptions.
- Active-listing child-content changes automatically return the listing to moderation.
- Admin-only email queueing with a template allowlist.
- Provider-aware Stripe/Razorpay refund execution.
- Stripe refund/dispute webhook state updates.
- Atomic coupon redemption counter updates.
- Dynamic robots.txt and sitemap.xml without placeholder domains.
- Baseline security response headers.
- Username sign-in without returning account email to the browser.

Validation performed in the build environment:

- TypeScript syntax scan across all TS/TSX source: no parser errors found.
- Full npm dependency installation could not complete within the available execution window, so a dependency-backed Vite production build could not be honestly marked as verified here.
