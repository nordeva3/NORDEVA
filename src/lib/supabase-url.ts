// The public URL of this deployment's Supabase project. It is not a secret
// (every visitor's browser talks to it directly); it exists as a last-resort
// fallback so a mistyped or missing dashboard env var cannot take the whole
// site down. Any SUPABASE_URL / VITE_SUPABASE_URL env var overrides it.
export const FALLBACK_SUPABASE_URL = "https://ecvooxkqtuqcyxpkvmac.supabase.co";

// The matching publishable (anon) key for the same project. Publishable keys
// are public by design — this exact value is shipped to every visitor's
// browser, and row-level security is what protects the data. It exists as a
// last-resort fallback for the same reason as the URL above: a hosting
// dashboard that drops the build-time VITE_ variables must not be able to
// break the browser client. Any SUPABASE_PUBLISHABLE_KEY /
// VITE_SUPABASE_PUBLISHABLE_KEY env var overrides it. (The service-role key
// is a real secret and must NEVER get a fallback like this.)
export const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_usdHSGZTVRqj2KW12hZQXQ_TKfvJWUw";
