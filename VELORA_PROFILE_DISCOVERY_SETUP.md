# VELORA Marketplace Profiles — v5 update

This update adds:

- `/people`: marketplace seller discovery with debounced name/username search.
- `Find sellers` navigation entry for desktop and mobile navigation layouts that use the shared navigation list.
- Public creator profile verification badge, based on the trusted seller verification status.
- An additive Supabase migration with public `verified` profile flag and search indexes.

## Important: apply the database migration

The app needs the new `public_profiles.verified` column before the new pages can display data.

1. Open the Supabase dashboard for the project used by VELORA.
2. Open **SQL Editor** and create a new query.
3. Copy the entire contents of `supabase/migrations/20261028020000_marketplace_public_profiles_search_verified.sql` into the editor.
4. Run it once and confirm there are no SQL errors.

The migration is additive. It does not delete profiles, products, or verification records. The verified badge is set from `seller_verifications.status = 'verified'`; ordinary users do not get a client-side write path to award themselves the badge.

## Configure local environment

Copy `.env.example` to `.env` and fill the project URL and publishable key in the four Supabase entries required by the current project setup:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Do not commit `.env` or expose `SUPABASE_SERVICE_ROLE_KEY`, payment secrets, or other server-only keys in the browser.

## Run in Termux

```bash
cd ~/velora-test/VELORA
npm install
npm run build
npm run dev -- --host 0.0.0.0
```

Open `http://localhost:3000/people` in the same Android device's browser while the dev server remains running. The existing app's other routes and source files are retained in this ZIP.

## Notes

- The profile search returns up to 40 public profiles per query and uses a short debounce while typing.
- The public profile view exposes only public profile fields, not private account emails or KYC documents.
- Build and browser tests should be run after extracting on the target Termux environment. This archive was checked for ZIP integrity, but this packaging environment could not complete a fresh dependency installation/build.
