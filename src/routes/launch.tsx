import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import {
  CheckCircle2,
  CircleAlert,
  Database,
  Globe2,
  LockKeyhole,
  Server,
  ShieldCheck,
  CreditCard,
} from "lucide-react";

export const Route = createFileRoute("/launch")({ component: LaunchPage });

type Check = { label: string; detail: string; ok: boolean; critical?: boolean; icon: any };

function LaunchPage() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const env = await Promise.resolve({
        supabase: Boolean(
          import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        ),
        appUrl: Boolean(import.meta.env.VITE_APP_URL),
      });
      const { data: ping, error } = await supabase.from("listings").select("id").limit(1);
      const { data: storage } = await supabase.storage.listBuckets();
      let health: any = null;
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        health = response.ok ? await response.json() : null;
      } catch {
        health = null;
      }
      setChecks([
        {
          label: "Supabase client configuration",
          detail: env.supabase
            ? "URL + publishable key detected."
            : "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.",
          ok: env.supabase,
          critical: true,
          icon: Database,
        },
        {
          label: "Database connectivity",
          detail: ping ? "Marketplace database responded." : "Database query failed.",
          ok: !error,
          critical: true,
          icon: Server,
        },
        {
          label: "Private storage",
          detail: storage?.some((b) => b.name === "listing-files" && !b.public)
            ? "listing-files bucket is private."
            : "Create a private listing-files bucket before launch.",
          ok: Boolean(storage?.some((b) => b.name === "listing-files" && !b.public)),
          critical: true,
          icon: LockKeyhole,
        },
        {
          label: "Application URL",
          detail: env.appUrl
            ? "VITE_APP_URL is present."
            : "Set VITE_APP_URL to the HTTPS production origin.",
          ok: env.appUrl,
          icon: Globe2,
        },
        {
          label: "Global payment provider",
          detail: health?.integrations?.stripe
            ? "Stripe Checkout is configured."
            : health?.integrations?.razorpay
              ? "Razorpay is configured for international/multi-currency checkout."
              : "Configure Stripe or Razorpay server credentials.",
          ok: Boolean(health?.integrations?.stripe || health?.integrations?.razorpay),
          critical: true,
          icon: CreditCard,
        },
        {
          label: "Payment webhooks",
          detail: health?.integrations?.stripe
            ? health?.integrations?.stripeWebhook
              ? "Stripe webhook signing secret detected."
              : "Configure STRIPE_WEBHOOK_SECRET."
            : health?.integrations?.razorpay
              ? health?.integrations?.razorpayWebhook
                ? "Razorpay webhook secret detected."
                : "Configure RAZORPAY_WEBHOOK_SECRET."
              : "Configure a payment provider first.",
          ok: Boolean(
            (health?.integrations?.stripe && health?.integrations?.stripeWebhook) ||
            (health?.integrations?.razorpay && health?.integrations?.razorpayWebhook),
          ),
          critical: true,
          icon: ShieldCheck,
        },
        {
          label: "Server-only payment secrets",
          detail:
            "Payment secret keys and webhook signing secrets must never be exposed through VITE_* variables.",
          ok: true,
          icon: ShieldCheck,
        },
      ]);
      setLoading(false);
    })();
  }, []);
  const criticalFailed = checks.filter((c) => c.critical && !c.ok).length;
  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-lume/25 bg-lume/10 px-3 py-1 text-xs text-lume">
            <ShieldCheck className="size-3.5" /> Launch readiness
          </div>
          <h1 className="mt-4 text-3xl font-semibold sm:text-5xl">Production launch checker</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This validates browser-visible configuration and live Supabase connectivity without
            exposing server secrets.
          </p>
        </div>
        {loading ? (
          <div className="mt-8 grid gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-20" />
            ))}
          </div>
        ) : (
          <>
            <div
              className={`mt-8 rounded-2xl border p-5 ${criticalFailed ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}
            >
              <div className="flex items-center gap-3">
                {criticalFailed ? (
                  <CircleAlert className="size-5 text-amber-400" />
                ) : (
                  <CheckCircle2 className="size-5 text-emerald-400" />
                )}
                <div>
                  <div className="font-medium">
                    {criticalFailed
                      ? `${criticalFailed} critical checks need attention`
                      : "Browser-side launch checks passed"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Provider credentials, webhook delivery, malware scanning, email and payout
                    execution still depend on server/provider configuration.
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-6 divide-y divide-border/60 rounded-2xl border border-border/60 bg-card">
              {checks.map((c) => {
                const Icon = c.icon;
                return (
                  <div key={c.label} className="flex gap-4 p-5">
                    <Icon
                      className={`mt-0.5 size-5 ${c.ok ? "text-emerald-400" : "text-amber-400"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{c.label}</div>
                      <p className="mt-1 text-xs text-muted-foreground">{c.detail}</p>
                    </div>
                    {c.ok ? (
                      <CheckCircle2 className="size-5 text-emerald-400" />
                    ) : (
                      <CircleAlert className="size-5 text-amber-400" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/marketplace-os"
                className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/50"
              >
                Marketplace OS
              </Link>
              <Link
                to="/admin"
                className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/50"
              >
                Admin 2.0
              </Link>
              <Link
                to="/status"
                className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/50"
              >
                Status
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
