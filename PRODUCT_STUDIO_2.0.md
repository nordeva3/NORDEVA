# VELORA Product Studio 2.0

The `/sell` route is now a complete multi-step digital-product creation studio. Existing seller/auth/commerce flows are preserved.

## Included

- Product type and marketplace category
- Short/full descriptions, subcategory, tags, audience, languages
- Features and included-items lists
- Cover image, screenshot/gallery media, preview video and live demo URL
- Main delivery file plus up to 20 additional assets
- Worldwide ISO currency selector from the existing currency catalogue
- One-time, subscription, free and pay-what-you-want pricing models
- Multiple product variants/tiers
- Trial days and minimum PWYW price fields
- License type, seats, activation limit and duration
- Requirements, platforms, stack, formats, version/release/update dates
- Documentation/support URLs and FAQ entries
- Tax category and seller legal declarations
- AI disclosure
- SEO title/description/keywords
- Product quality score and publish checklist
- Private storage until moderation

## Database migration

Apply:
`supabase/migrations/20260926100000_product_studio_admin.sql`

It adds product metadata, media, downloadable asset records, FAQs, admin task queues, user controls and seller verification documents without replacing existing tables.

## Important production integration

The upload UI deliberately keeps files private and routes every new product into moderation. A production malware scanner should be connected to the storage event/queue before allowing unrestricted automatic publication. The UI does not falsely claim that an external scanner has run.
