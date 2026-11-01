import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const checks = [];
const must = [
  "src/lib/payment.functions.ts",
  "src/lib/production-completion.functions.ts",
  "src/lib/lume-ai.functions.ts",
  "src/components/tag-input.tsx",
  "src/lib/market.ts",
  "src/server.ts",
  "supabase/migrations/20260926160000_production_completion.sql",
  "supabase/migrations/20260927000000_full_hardening_and_search.sql",
  ".github/workflows/production.yml",
  "supabase/CRON_SETUP.sql",
  "PRODUCTION_LAUNCH_CHECKLIST.md",
  "playwright.config.ts",
  "tests/smoke.spec.ts",
  ".agents/skills/strix-security/SKILL.md",
  ".agents/skills/ui-test/SKILL.md",
];
for (const file of must) checks.push([file, existsSync(file)]);

const env = readFileSync(".env.example", "utf8");
for (const key of [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "WORKER_SECRET",
  "EMAIL_PROVIDER_URL",
  "MALWARE_SCANNER_URL",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
])
  checks.push([`.env.example:${key}`, env.includes(key)]);

const completionSource = readFileSync("src/lib/production-completion.functions.ts", "utf8");
const aiSource = readFileSync("src/lib/lume-ai.functions.ts", "utf8");
const tagSource = readFileSync("src/components/tag-input.tsx", "utf8");
const marketSource = readFileSync("src/lib/market.ts", "utf8");
const browseSource = readFileSync("src/routes/browse.tsx", "utf8");
const integrationsSource = readFileSync("src/lib/production-integrations.server.ts", "utf8");
const serverSource = readFileSync("src/server.ts", "utf8");
const productionSql = readFileSync(
  "supabase/migrations/20260927000000_full_hardening_and_search.sql",
  "utf8",
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

checks.push([
  "Stripe Connect capability keys quoted",
  completionSource.includes('"capabilities[card_payments][requested]"') &&
    completionSource.includes('"capabilities[transfers][requested]"'),
]);
checks.push([
  "Email queue has admin gate",
  completionSource.includes("Admin access required") && completionSource.includes("email_outbox"),
]);
checks.push([
  "NORDEVA AI uses Gemini server key",
  aiSource.includes("GEMINI_API_KEY") &&
    aiSource.includes("generativelanguage.googleapis.com/v1/interactions") &&
    !aiSource.includes("OPENAI_API_KEY") &&
    !aiSource.includes("api.openai.com"),
]);
checks.push([
  "NORDEVA AI preserves text safely",
  aiSource.includes("extractGeminiText") &&
    aiSource.includes("store: false") &&
    aiSource.includes("NORDEVA AI is temporarily unavailable") &&
    aiSource.includes("message.content"),
]);
checks.push([
  "Tag input supports Enter/comma chips",
  tagSource.includes('event.key === "Enter"') && tagSource.includes('next.includes(",")'),
]);
checks.push([
  "Search uses server suggestions",
  marketSource.includes("search_suggestions") && browseSource.includes("fetchSearchSuggestions"),
]);
checks.push([
  "Provider-aware refunds",
  integrationsSource.includes("createStripeRefund") &&
    integrationsSource.includes('order.provider === "stripe"'),
]);
checks.push([
  "Dynamic sitemap/robots",
  serverSource.includes('url.pathname === "/sitemap.xml"') &&
    serverSource.includes('url.pathname === "/robots.txt"'),
]);
checks.push([
  "Payment accounts client writes revoked",
  productionSql.includes("REVOKE ALL ON public.seller_payment_accounts FROM anon, authenticated"),
]);
checks.push([
  "Subscriptions client writes revoked",
  productionSql.includes(
    "REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM authenticated",
  ),
]);
checks.push([
  "Active child edits trigger moderation",
  productionSql.includes("enforce_active_listing_child_moderation"),
]);
checks.push([
  "Search RPC present",
  productionSql.includes("CREATE OR REPLACE FUNCTION public.search_suggestions") &&
    productionSql.includes("CREATE OR REPLACE FUNCTION public.search_listing_ids"),
]);
checks.push([
  "Playwright CLI dependency present",
  Boolean(packageJson.devDependencies?.["@playwright/cli"]),
]);
checks.push([
  "Playwright Test dependency present",
  Boolean(packageJson.devDependencies?.["@playwright/test"]),
]);
checks.push(["Strix skill guidance present", existsSync(".agents/skills/strix-security/SKILL.md")]);
checks.push(["UI test skill guidance present", existsSync(".agents/skills/ui-test/SKILL.md")]);

const placeholders = [];
for (const dir of ["src", "supabase", "public"]) {
  if (!existsSync(dir)) continue;
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(ts|tsx|sql|md|txt|xml)$/.test(f.name)) {
        const t = readFileSync(p, "utf8");
        if (t.includes("YOUR-DOMAIN.example")) placeholders.push(p);
      }
    }
  };
  walk(dir);
}
checks.push(["No placeholder domain in runtime/source assets", placeholders.length === 0]);

const oldProviderRefs = [];
for (const dir of ["src", "supabase", "public"]) {
  if (!existsSync(dir)) continue;
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(ts|tsx|sql|env|md|txt|json)$/.test(f.name)) {
        const t = readFileSync(p, "utf8");
        if (/OPENAI_API_KEY|api\.openai\.com/.test(t)) oldProviderRefs.push(p);
      }
    }
  };
  walk(dir);
}
checks.push(["No OpenAI runtime provider references", oldProviderRefs.length === 0]);
checks.push([
  "Gemini uses stable Interactions API endpoint",
  readFileSync("src/lib/lume-ai.functions.ts", "utf8").includes(
    "https://generativelanguage.googleapis.com/v1/interactions",
  ),
]);
checks.push([
  "AI chat validates stored history before reuse",
  readFileSync("src/components/lume-ai-chatbot.tsx", "utf8").includes("isValidMessage") &&
    readFileSync("src/components/lume-ai-chatbot.tsx", "utf8").includes(
      "parsed.filter(isValidMessage)",
    ),
]);

const currencySource = readFileSync("src/lib/currencies.ts", "utf8");
const sellSource = readFileSync("src/routes/sell.tsx", "utf8");
const usdMigration = readFileSync("supabase/migrations/20261028010000_velora_usd_only.sql", "utf8");
const updatesMigration = readFileSync(
  "supabase/migrations/20260926090000_global_marketplace_suite.sql",
  "utf8",
);
checks.push([
  "NORDEVA package identity/version",
  packageJson.name === "nordeva" && packageJson.version === "3.0.0",
]);
checks.push([
  "Marketplace display currency fixed to USD",
  currencySource.includes('MARKETPLACE_CURRENCY = "USD"') &&
    currencySource.includes("const code = MARKETPLACE_CURRENCY"),
]);
checks.push([
  "Database rejects non-USD marketplace prices",
  usdMigration.includes("velora_listings_usd_currency") &&
    usdMigration.includes("velora_variants_usd_currency") &&
    usdMigration.includes("enforce_velora_usd_currency"),
]);
checks.push([
  "Publication requires clean scans for every delivery asset",
  usdMigration.includes("clean_asset_count < asset_count") &&
    usdMigration.includes("unsafe_scan_count > 0"),
]);
checks.push([
  "Upload validation and partial-upload cleanup",
  sellSource.includes("validateSafeFileName") &&
    sellSource.includes("MAX_TOTAL_UPLOAD_MB") &&
    sellSource.includes("uploadedPrivatePaths") &&
    sellSource.includes("mainUpload.error"),
]);
checks.push([
  "Product update paths limited to owners/admins/purchasers",
  updatesMigration.includes("o.status = 'completed'") &&
    !updatesMigration.includes(
      'CREATE POLICY "product updates readable" ON public.product_updates FOR SELECT USING (true)',
    ),
]);

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed = true;
}
if (placeholders.length) console.log(placeholders.join("\n"));
if (oldProviderRefs.length) console.log(oldProviderRefs.join("\n"));
process.exit(failed ? 1 : 0);
