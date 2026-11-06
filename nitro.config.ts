import { defineConfig } from "nitro";

export default defineConfig({
  preset: "cloudflare_pages",
  // Workers Static Assets requires a compatibility date >= 2024-09-19.
  compatibilityDate: "2025-09-01",
  cloudflare: {
    deployConfig: true,
    nodeCompat: true,
  },
});

// Redeploy note (2026-11-06): each production build picks up the dashboard-managed
// secrets (Supabase + Stripe test keys) saved on the Pages project.
