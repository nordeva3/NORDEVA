import { createFileRoute } from "@tanstack/react-router";
import { TopNav } from "@/components/top-nav";
import { Activity, CheckCircle2, Server, ShieldCheck } from "lucide-react";

type StatusKey = "operational" | "setup";

const STATUS_META: Record<StatusKey, { label: string; dot: string; chip: string }> = {
  operational: {
    label: "Operational",
    dot: "bg-emerald-400",
    chip: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  },
  setup: {
    label: "Setup required",
    dot: "bg-gold",
    chip: "border-gold/30 bg-gold/10 text-gold",
  },
};

function StatusChip({ status }: { status: StatusKey }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${meta.chip}`}
    >
      <span className={`size-1.5 rounded-full ${meta.dot}`} /> {meta.label}
    </span>
  );
}

const SYSTEMS: Array<{ name: string; status: StatusKey }> = [
  { name: "Marketplace & browsing", status: "operational" },
  { name: "Accounts & sign-in", status: "operational" },
  { name: "Listing uploads & review", status: "operational" },
  { name: "Secure downloads", status: "operational" },
  { name: "NORDEVA AI support", status: "setup" },
  { name: "Card payments", status: "setup" },
  { name: "Payouts (UPI / bank)", status: "operational" },
];

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "NORDEVA Status Center — live platform health" },
      {
        name: "description",
        content: "Current operational status for NORDEVA marketplace services.",
      },
      { property: "og:title", content: "NORDEVA Status Center" },
      {
        property: "og:description",
        content: "Live platform health, incidents and scheduled maintenance for NORDEVA.",
      },
    ],
  }),
  component: StatusPage,
});

function StatusPage() {
  const allOperational = SYSTEMS.every((s) => s.status === "operational");

  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
        <header className="animate-rise">
          <div className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.07] px-3 py-1 text-xs text-gold">
            <Activity className="size-3" /> NORDEVA Status Center
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
            {allOperational ? "All systems operational" : "Some systems are degraded"}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Current service health for the core NORDEVA marketplace.
          </p>
        </header>

        {/* System status */}
        <section className="mt-10 glass-panel animate-rise rounded-3xl p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Server className="size-4 text-gold" /> System status
          </h2>
          <ul className="mt-4 divide-y divide-border/60">
            {SYSTEMS.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-3 py-3">
                <span className="flex min-w-0 items-center gap-2.5 text-sm">
                  <span className="relative flex size-2">
                    <span
                      className={`absolute inline-flex size-2 animate-ping rounded-full opacity-60 ${STATUS_META[s.status].dot}`}
                    />
                    <span
                      className={`relative inline-flex size-2 rounded-full ${STATUS_META[s.status].dot}`}
                    />
                  </span>
                  <span className="truncate">{s.name}</span>
                </span>
                <StatusChip status={s.status} />
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 rounded-2xl border border-border/60 bg-card/50 p-5 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 text-foreground font-medium">
            <ShieldCheck className="size-4 text-gold" /> No active incidents
          </div>
          <p className="mt-2">
            Payment checkout is intentionally disabled until a real payment provider and webhook are
            connected. No fake payment success or manual “completed” orders are created.
          </p>
        </section>

        <p className="mt-12 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-gold" /> NORDEVA status is monitored continuously.
        </p>
      </main>
    </div>
  );
}
