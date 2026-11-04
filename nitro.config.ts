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
