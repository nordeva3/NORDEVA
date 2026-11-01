import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  BarChart3,
  CheckCircle2,
  Code2,
  Gift,
  KeyRound,
  LifeBuoy,
  MessageSquare,
  Percent,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Store,
  WalletCards,
  XCircle,
} from "lucide-react";
import { formatMoney } from "@/lib/currencies";

export const Route = createFileRoute("/marketplace-os")({ component: MarketplaceOS });

type Tab = "overview" | "storefront" | "commerce" | "customers" | "growth" | "security";

const modules = [
  ["Subscriptions", "subscriptions", "Recurring products, plans and access"],
  ["Licenses", "license_keys", "Buyer license keys and seats"],
  ["Gift cards", "gift_cards", "Stored-value commerce records"],
  ["Messages", "messages", "Buyer ↔ seller conversations"],
  ["Support", "support_tickets", "Tickets and support history"],
  ["Collections", "collections", "Curated public/private collections"],
  ["Affiliate", "affiliate_programs", "Referral programmes and attribution"],
  ["API keys", "api_keys", "Developer access"],
  ["Analytics", "analytics_events", "UTM, conversion and product events"],
  ["Verification", "seller_verifications", "Seller verification workflow"],
  ["Payouts", "payout_requests", "Seller withdrawals and audit trail"],
  ["Coupons", "coupons", "Discounts and redemption records"],
] as const;

function MarketplaceOS() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Record<string, any[]>>({});
  const [store, setStore] = useState<any>({
    store_name: "",
    tagline: "",
    bio: "",
    website_url: "",
    is_public: true,
  });
  const [supportSubject, setSupportSubject] = useState("");
  const [supportBody, setSupportBody] = useState("");
  const [coupon, setCoupon] = useState({ code: "", type: "percent", value: "10" });
  const [apiName, setApiName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (uid: string) => {
    setLoading(true);
    const names = modules.map((m) => m[1]);
    const entries = await Promise.all(
      names.map(async (name) => {
        const result = await supabase
          .from(name as any)
          .select("*")
          .eq(
            name === "analytics_events"
              ? "user_id"
              : name === "license_keys"
                ? "buyer_id"
                : name === "messages"
                  ? "sender_id"
                  : name === "support_tickets"
                    ? "user_id"
                    : name === "collections"
                      ? "owner_id"
                      : name === "affiliate_programs"
                        ? "seller_id"
                        : name === "coupons"
                          ? "seller_id"
                          : name === "seller_verifications"
                            ? "user_id"
                            : name === "payout_requests"
                              ? "user_id"
                              : "user_id",
            uid,
          )
          .order("created_at", { ascending: false })
          .limit(20);
        return [name, result.data ?? []] as const;
      }),
    );
    const { data: storefront } = await supabase
      .from("storefront_settings")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    setData(Object.fromEntries(entries));
    if (storefront) setStore(storefront);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data: auth }) => {
      if (!auth.user) navigate({ to: "/auth", search: { next: "/marketplace-os" } });
      else {
        setUserId(auth.user.id);
        void load(auth.user.id);
      }
    });
  }, [navigate]);

  const stats = useMemo(
    () => ({
      products: data.coupons?.length ?? 0,
      sales: data.license_keys?.length ?? 0,
      messages: data.messages?.length ?? 0,
      events: data.analytics_events?.length ?? 0,
    }),
    [data],
  );

  const saveStore = async () => {
    if (!userId) return;
    setBusy(true);
    const { error } = await supabase
      .from("storefront_settings")
      .upsert({ user_id: userId, ...store }, { onConflict: "user_id" });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Storefront saved");
  };

  const createCoupon = async () => {
    if (!userId || !coupon.code.trim() || Number(coupon.value) <= 0)
      return toast.error("Enter a valid coupon");
    setBusy(true);
    const { error } = await supabase.from("coupons").insert({
      seller_id: userId,
      code: coupon.code.trim().toUpperCase(),
      discount_type: coupon.type,
      discount_value: Number(coupon.value),
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Coupon created");
      setCoupon({ code: "", type: "percent", value: "10" });
      if (userId) void load(userId);
    }
  };

  const createTicket = async () => {
    if (!userId || !supportSubject.trim() || !supportBody.trim())
      return toast.error("Enter a subject and message");
    setBusy(true);
    const { data: ticket, error } = await supabase
      .from("support_tickets")
      .insert({ user_id: userId, subject: supportSubject.trim(), category: "general" })
      .select("id")
      .single();
    if (!error && ticket)
      await supabase
        .from("support_messages")
        .insert({ ticket_id: ticket.id, sender_id: userId, body: supportBody.trim() });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Support ticket opened");
      setSupportSubject("");
      setSupportBody("");
      if (userId) void load(userId);
    }
  };

  const createApiKey = async () => {
    if (!userId || !apiName.trim()) return toast.error("Name your API key");
    const raw = `velora_${crypto.randomUUID().replaceAll("-", "")}_${crypto.randomUUID().replaceAll("-", "")}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const { error } = await supabase.from("api_keys").insert({
      user_id: userId,
      name: apiName.trim(),
      key_prefix: raw.slice(0, 12),
      key_hash: hash,
    });
    if (error) toast.error(error.message);
    else {
      setApiName("");
      window.prompt("Copy your API key now. NORDEVA stores only its hash.", raw);
      toast.success("API key created");
      void load(userId);
    }
  };

  if (!userId) return null;
  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:py-12">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-lume/25 bg-lume/10 px-3 py-1 text-xs text-lume">
              <Settings2 className="size-3.5" /> Marketplace OS 2.0
            </div>
            <h1 className="mt-4 text-3xl font-semibold sm:text-4xl">
              Everything you need to run NORDEVA.
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              One control center for commerce, seller operations, customer support, growth, security
              and launch readiness.
            </p>
          </div>
          <Button variant="outline" onClick={() => void load(userId)}>
            <RefreshCw className="mr-2 size-4" />
            Refresh
          </Button>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Coupons", stats.products, Percent],
            ["Licenses", stats.sales, KeyRound],
            ["Messages", stats.messages, MessageSquare],
            ["Events", stats.events, BarChart3],
          ].map(([label, value, Icon]: any) => (
            <div className="surface p-5" key={label as string}>
              <Icon className="size-5 text-lume" />
              <div className="mt-3 text-2xl font-semibold">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex gap-1 overflow-x-auto rounded-2xl border border-border/60 bg-card/50 p-1">
          {(["overview", "storefront", "commerce", "customers", "growth", "security"] as Tab[]).map(
            (t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm capitalize transition ${tab === t ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t}
              </button>
            ),
          )}
        </div>

        {loading ? (
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="skeleton h-48" />
            <div className="skeleton h-48" />
          </div>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            {(tab === "overview" || tab === "commerce") && (
              <Panel title="Commerce engine" icon={<WalletCards className="size-5" />}>
                <ModuleGrid
                  names={["subscriptions", "license_keys", "gift_cards", "coupons"]}
                  data={data}
                />
              </Panel>
            )}
            {(tab === "overview" || tab === "customers") && (
              <Panel title="Customer experience" icon={<LifeBuoy className="size-5" />}>
                <ModuleGrid names={["messages", "support_tickets", "collections"]} data={data} />
              </Panel>
            )}
            {(tab === "overview" || tab === "growth") && (
              <Panel title="Growth & analytics" icon={<BarChart3 className="size-5" />}>
                <ModuleGrid
                  names={["analytics_events", "affiliate_programs", "api_keys"]}
                  data={data}
                />
              </Panel>
            )}
            {(tab === "overview" || tab === "security") && (
              <Panel title="Trust, verification & money" icon={<ShieldCheck className="size-5" />}>
                <ModuleGrid
                  names={["seller_verifications", "payout_requests", "coupons"]}
                  data={data}
                />
              </Panel>
            )}

            {tab === "storefront" && (
              <Panel title="Creator storefront" icon={<Store className="size-5" />}>
                <div className="space-y-4">
                  <Input
                    placeholder="Store name"
                    value={store.store_name ?? ""}
                    onChange={(e) => setStore((s: any) => ({ ...s, store_name: e.target.value }))}
                  />
                  <Input
                    placeholder="Tagline"
                    value={store.tagline ?? ""}
                    onChange={(e) => setStore((s: any) => ({ ...s, tagline: e.target.value }))}
                  />
                  <Textarea
                    placeholder="Public seller bio"
                    value={store.bio ?? ""}
                    onChange={(e) => setStore((s: any) => ({ ...s, bio: e.target.value }))}
                  />
                  <Input
                    placeholder="Website URL"
                    value={store.website_url ?? ""}
                    onChange={(e) => setStore((s: any) => ({ ...s, website_url: e.target.value }))}
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={store.is_public !== false}
                      onChange={(e) =>
                        setStore((s: any) => ({ ...s, is_public: e.target.checked }))
                      }
                    />{" "}
                    Public storefront
                  </label>
                  <Button disabled={busy} onClick={saveStore}>
                    Save storefront
                  </Button>
                </div>
              </Panel>
            )}

            {tab === "commerce" && (
              <Panel title="Coupons & discounts" icon={<Percent className="size-5" />}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input
                    placeholder="SAVE10"
                    value={coupon.code}
                    onChange={(e) => setCoupon((c) => ({ ...c, code: e.target.value }))}
                  />
                  <Input
                    type="number"
                    min="0.01"
                    placeholder="10"
                    value={coupon.value}
                    onChange={(e) => setCoupon((c) => ({ ...c, value: e.target.value }))}
                  />
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={coupon.type}
                    onChange={(e) => setCoupon((c) => ({ ...c, type: e.target.value }))}
                  >
                    <option value="percent">Percent</option>
                    <option value="fixed">Fixed</option>
                  </select>
                  <Button disabled={busy} onClick={createCoupon} className="sm:col-span-3">
                    Create coupon
                  </Button>
                </div>
              </Panel>
            )}

            {tab === "customers" && (
              <Panel title="Support desk" icon={<LifeBuoy className="size-5" />}>
                <div className="space-y-3">
                  <Input
                    placeholder="Subject"
                    value={supportSubject}
                    onChange={(e) => setSupportSubject(e.target.value)}
                  />
                  <Textarea
                    placeholder="Describe the issue"
                    value={supportBody}
                    onChange={(e) => setSupportBody(e.target.value)}
                  />
                  <Button disabled={busy} onClick={createTicket}>
                    Open support ticket
                  </Button>
                </div>
              </Panel>
            )}

            {tab === "growth" && (
              <Panel title="Developer API" icon={<Code2 className="size-5" />}>
                <div className="flex gap-3">
                  <Input
                    placeholder="API key name"
                    value={apiName}
                    onChange={(e) => setApiName(e.target.value)}
                  />
                  <Button onClick={createApiKey}>
                    <KeyRound className="mr-2 size-4" />
                    Create key
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Keys are hashed before storage. The raw secret is shown once.
                </p>
              </Panel>
            )}

            {tab === "security" && (
              <Panel
                title="Launch & production readiness"
                icon={<ShieldCheck className="size-5" />}
              >
                <p className="text-sm text-muted-foreground">
                  Use the launch checker for environment, database, payments, storage and
                  operational readiness.
                </p>
                <Button asChild className="mt-4">
                  <Link to="/launch">Open launch checker</Link>
                </Button>
              </Panel>
            )}
          </div>
        )}

        <section className="mt-8 surface p-5">
          <h2 className="font-medium">Module coverage</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map(([label, table, desc]) => (
              <div
                key={table}
                className="flex items-start gap-3 rounded-xl border border-border/50 bg-muted/20 p-3"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                <div>
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="surface p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-lume">{icon}</span>
        <h2 className="font-medium">{title}</h2>
      </div>
      {children}
    </section>
  );
}
function ModuleGrid({ names, data }: { names: string[]; data: Record<string, any[]> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {names.map((n) => (
        <div key={n} className="rounded-xl border border-border/50 bg-muted/20 p-4">
          <div className="text-sm font-medium capitalize">{n.replaceAll("_", " ")}</div>
          <div className="mt-1 text-2xl font-semibold">{data[n]?.length ?? 0}</div>
          <div className="text-xs text-muted-foreground">recent records</div>
        </div>
      ))}
    </div>
  );
}
