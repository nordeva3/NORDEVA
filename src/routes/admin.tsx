import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { StatCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart3,
  BellRing,
  Briefcase,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileCheck2,
  Flag,
  Gauge,
  Headphones,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Loader2,
  LockKeyhole,
  MessageSquare,
  PackageCheck,
  Palette,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Tags,
  UserCog,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { formatMoney } from "@/lib/currencies";
import {
  effectiveStatus,
  packageBadgeLabel,
  PROJECT_STATUSES,
  type RequestLike,
} from "@/lib/project-requests";
import {
  getAdminCommandCenter,
  adminUpdateListing,
  adminUpdateVerification,
  adminUpdateTicket,
  adminUpdateUser,
  adminCreateTask,
  adminResolveDispute,
} from "@/lib/admin-v2.functions";
import { resolveReport } from "@/lib/admin.functions";
import { runScanQueueNow } from "@/lib/security.functions";
import { getAppearance, saveAppearance } from "@/lib/appearance.functions";
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  applyAppearance,
  cacheAppearance,
  validateAppearance,
  type AppearanceConfig,
  type PromoBannerConfig,
} from "@/lib/appearance";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Command Center — NORDEVA" },
      {
        name: "description",
        content: "NORDEVA marketplace operations and moderation command center.",
      },
    ],
  }),
  component: AdminPage,
});

type AdminData = Awaited<ReturnType<typeof getAdminCommandCenter>>;
const nav = [
  ["overview", "Overview", LayoutDashboard],
  ["moderation", "Moderation", PackageCheck],
  ["security", "Security", ShieldAlert],
  ["orders", "Orders & money", CircleDollarSign],
  ["projects", "Projects", Briefcase],
  ["sellers", "Sellers & KYC", ShieldCheck],
  ["support", "Support", Headphones],
  ["users", "Users", Users],
  ["reports", "Reports", Flag],
  ["analytics", "Analytics", BarChart3],
  ["categories", "Categories", Tags],
  ["design", "Design", Palette],
  ["tasks", "Operations", ListChecks],
] as const;

/* Sidebar layout (redesign wave R6): items map 1:1 to the existing admin
   tabs above and drive the same `tab` state the sr-only Tabs list and the
   "lume-admin-tab" event already use. Content panels are untouched. */
function AdminSidebar({
  tab,
  onSelect,
  email,
  pendingListings,
  disputedProjects,
}: {
  tab: string;
  onSelect: (tab: string) => void;
  email: string | null;
  pendingListings: number;
  disputedProjects: number;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const select = (id: string) => {
    onSelect(id);
    if (isMobile) setOpenMobile(false);
  };
  return (
    <Sidebar collapsible="icon" style={{ top: "4rem", height: "calc(100svh - 4rem)" }}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ShieldAlert className="size-5" />
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">NORDEVA Admin</span>
                <span className="truncate text-xs text-muted-foreground">
                  {email ?? "Signed in"}
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <p className="px-2 text-xs leading-relaxed text-muted-foreground group-data-[collapsible=icon]:hidden">
          Marketplace operations, trust and revenue control.
        </p>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {nav.map(([id, label, Icon]) => (
              <SidebarMenuItem key={id}>
                <SidebarMenuButton isActive={tab === id} onClick={() => select(id)} tooltip={label}>
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
                {id === "moderation" && pendingListings > 0 ? (
                  <SidebarMenuBadge className="bg-amber-500/20 text-amber-500">
                    {pendingListings}
                  </SidebarMenuBadge>
                ) : id === "projects" && disputedProjects > 0 ? (
                  <SidebarMenuBadge className="bg-red-500/20 text-red-400">
                    {disputedProjects} disputed
                  </SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Seller dashboard">
              <Link to="/dashboard">
                <ChevronRight />
                <span>Seller dashboard</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="View marketplace">
              <Link to="/browse">
                <ChevronRight />
                <span>View marketplace</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function AdminPage() {
  const navigate = useNavigate();
  const getData = useServerFn(getAdminCommandCenter);
  const updateListing = useServerFn(adminUpdateListing);
  const updateVerification = useServerFn(adminUpdateVerification);
  const updateTicket = useServerFn(adminUpdateTicket);
  const updateUser = useServerFn(adminUpdateUser);
  const createTask = useServerFn(adminCreateTask);
  const resolveReportFn = useServerFn(resolveReport);
  const resolveDispute = useServerFn(adminResolveDispute);
  const [data, setData] = useState<AdminData | null>(null);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setData(await getData({ data: {} }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Admin data could not be loaded");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const onAdminTab = (event: Event) => {
      const target = (event as CustomEvent<string>).detail;
      if (target) setTab(target);
    };
    document.addEventListener("lume-admin-tab", onAdminTab);
    supabase.auth.getUser().then(({ data: auth }) => {
      if (!auth.user) navigate({ to: "/auth", search: { next: "/admin" } });
      else {
        // Display-only: the signed-in admin's email for the sidebar header.
        // Authorization itself stays server-side in getAdminCommandCenter.
        setAdminEmail(auth.user.email ?? null);
        load();
      }
    });
    return () => document.removeEventListener("lume-admin-tab", onAdminTab);
  }, [navigate]);

  const filtered = useMemo(() => {
    if (!data || !query.trim()) return data;
    const q = query.toLowerCase();
    return {
      ...data,
      listings: data.listings.filter((x: any) =>
        `${x.title} ${x.category} ${x.status}`.toLowerCase().includes(q),
      ),
      users: data.users.filter((x: any) =>
        `${x.display_name} ${x.username} ${x.email}`.toLowerCase().includes(q),
      ),
      orders: data.orders.filter((x: any) =>
        `${x.id} ${x.buyer_email} ${x.currency}`.toLowerCase().includes(q),
      ),
      projects: data.projects.filter((x: any) =>
        `${x.title} ${x.status} ${x.project_status ?? ""} ${packageBadgeLabel(x) ?? ""}`
          .toLowerCase()
          .includes(q),
      ),
    };
  }, [data, query]);

  if (loading && !data)
    return (
      <div className="min-h-screen">
        <TopNav />
        <main className="mx-auto max-w-7xl px-4 py-20 text-center">
          <Loader2 className="mx-auto size-8 animate-spin text-lume" />
          <p className="mt-3 text-sm text-muted-foreground">Loading NORDEVA Command Center…</p>
        </main>
      </div>
    );
  if (!data) return null;
  const d = filtered ?? data;
  const stat = data.stats;
  const act = async (id: string, fn: () => Promise<unknown>, success: string) => {
    setBusyId(id);
    try {
      await fn();
      toast.success(success);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen">
      <TopNav />
      <SidebarProvider className="min-h-0">
        <AdminSidebar
          tab={tab}
          onSelect={setTab}
          email={adminEmail}
          pendingListings={stat.pendingListings}
          disputedProjects={stat.disputedProjects}
        />
        <SidebarInset className="min-w-0">
          <div className="mx-auto w-full max-w-[1500px] px-3 py-4 md:px-6 md:py-6">
            <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-2">
                <SidebarTrigger className="mt-2" />
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-lume">Operations</div>
                  <h1 className="mt-1 text-3xl font-semibold">Command Center</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Moderation, seller trust, customer support, payments and marketplace health.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    className="w-64 pl-9"
                    placeholder="Search users, products, orders…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <Button variant="outline" onClick={load}>
                  <RefreshCw className={loading ? "animate-spin" : ""} />
                </Button>
              </div>
            </header>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="sr-only">
                {nav.map(([id, label]) => (
                  <TabsTrigger key={id} value={id}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="overview">
                <Overview data={data} />
              </TabsContent>
              <TabsContent value="moderation">
                <Moderation
                  listings={d.listings}
                  busyId={busyId}
                  act={act}
                  updateListing={updateListing}
                />
              </TabsContent>
              <TabsContent value="security">
                <SecurityPanel listings={d.listings} updateListing={updateListing} />
              </TabsContent>
              <TabsContent value="orders">
                <Orders orders={d.orders} />
              </TabsContent>
              <TabsContent value="projects">
                <div className="space-y-5">
                  <DisputesPanel
                    disputes={data.disputes}
                    projects={data.projects}
                    users={data.users}
                    busyId={busyId}
                    act={act}
                    resolveDispute={resolveDispute}
                  />
                  <ProjectsPanel
                    projects={d.projects}
                    proposalCounts={data.projectProposalCounts}
                    users={data.users}
                  />
                </div>
              </TabsContent>
              <TabsContent value="sellers">
                <Sellers
                  data={d}
                  busyId={busyId}
                  act={act}
                  updateVerification={updateVerification}
                />
              </TabsContent>
              <TabsContent value="support">
                <Support
                  tickets={d.tickets}
                  busyId={busyId}
                  act={act}
                  updateTicket={updateTicket}
                />
              </TabsContent>
              <TabsContent value="users">
                <UsersPanel users={d.users} busyId={busyId} act={act} updateUser={updateUser} />
              </TabsContent>
              <TabsContent value="reports">
                <Reports
                  reports={d.reports}
                  users={data.users}
                  listings={data.listings}
                  busyId={busyId}
                  act={act}
                  resolveReport={resolveReportFn}
                />
              </TabsContent>
              <TabsContent value="analytics">
                <Analytics events={d.analytics} />
              </TabsContent>
              <TabsContent value="categories">
                <CategoriesPanel />
              </TabsContent>
              <TabsContent value="design">
                <DesignPanel />
              </TabsContent>
              <TabsContent value="tasks">
                <Tasks tasks={d.tasks} busyId={busyId} act={act} createTask={createTask} />
              </TabsContent>
            </Tabs>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

function Overview({ data }: { data: AdminData }) {
  const s = data.stats;
  const cards = [
    [
      "Gross sales",
      s.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      CircleDollarSign,
      "lume",
    ],
    [
      "Platform fees",
      s.platformFees.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      WalletCards,
      "gold",
    ],
    ["Users", s.totalUsers, Users, "blue"],
    ["Listings", s.totalListings, ShoppingBag, "purple"],
    ["Orders", s.totalOrders, PackageCheck, "green"],
    ["Pending review", s.pendingListings, ShieldAlert, "amber"],
    ["Open support", s.openTickets, Headphones, "cyan"],
    ["KYC queue", s.pendingVerifications, ShieldCheck, "pink"],
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, Icon]) => (
          <StatCard
            key={String(label)}
            label={label}
            value={value}
            sub="Live operational snapshot"
            icon={<Icon className="size-4 text-lume" />}
          />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
        <div className="surface p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Marketplace health</h2>
              <p className="text-xs text-muted-foreground">Current workflow queues.</p>
            </div>
            <Gauge className="text-lume" />
          </div>
          <Health
            label="Listing moderation"
            value={s.pendingListings}
            max={Math.max(10, s.totalListings)}
            tone="amber"
          />
          <Health
            label="Seller verification"
            value={s.pendingVerifications}
            max={Math.max(10, s.totalUsers)}
            tone="blue"
          />
          <Health
            label="Support queue"
            value={s.openTickets}
            max={Math.max(10, s.totalOrders)}
            tone="purple"
          />
          <Health
            label="Reports"
            value={s.openReports}
            max={Math.max(10, s.totalListings)}
            tone="red"
          />
        </div>
        <div className="surface p-5">
          <h2 className="font-semibold">Order status</h2>
          <div className="mt-4 space-y-3">
            {Object.entries(s.status.orders).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="capitalize text-muted-foreground">{k.replaceAll("_", " ")}</span>
                <Badge variant="outline">{v}</Badge>
              </div>
            ))}
            {Object.keys(s.status.orders).length === 0 && (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            )}
          </div>
        </div>
      </div>
      <div className="surface p-5">
        <div className="flex items-center gap-2">
          <BellRing className="size-4 text-lume" />
          <span className="font-medium">Operator checklist</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Moderate new products", s.pendingListings, "moderation"],
            ["Review KYC", s.pendingVerifications, "sellers"],
            ["Handle reports", s.openReports, "reports"],
            ["Answer customers", s.openTickets, "support"],
          ].map(([label, value, target]) => (
            <button
              key={String(target)}
              className="rounded-xl border p-4 text-left hover:border-primary/50"
              onClick={() =>
                document.dispatchEvent(new CustomEvent("lume-admin-tab", { detail: target }))
              }
            >
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-2 text-xl font-semibold">{value}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
function Health({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "amber" | "blue" | "purple" | "red";
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const toneClass = {
    amber: "bg-amber-500",
    blue: "bg-blue-500",
    purple: "bg-purple-500",
    red: "bg-red-500",
  }[tone];
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-2 flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${toneClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Moderation({
  listings,
  busyId,
  act,
  updateListing,
}: {
  listings: any[];
  busyId: string | null;
  act: any;
  updateListing: any;
}) {
  const pending = listings.filter((x) => x.status === "pending");
  return (
    <Panel title="Product moderation queue" icon={<PackageCheck />} count={pending.length}>
      <div className="divide-y divide-border/60">
        {pending.length === 0 ? (
          <Empty text="No products waiting for review." />
        ) : (
          pending.map((l) => (
            <div key={l.id} className="p-5">
              <div className="flex flex-wrap gap-4">
                <div className="size-20 overflow-hidden rounded-xl bg-muted">
                  {l.cover_url ? (
                    <img src={l.cover_url} className="size-full object-cover" />
                  ) : (
                    <div className="size-full lume-gradient opacity-30" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{l.title}</h3>
                    <Badge variant="secondary">{l.kind}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {l.category || "Uncategorized"} ·{" "}
                    {l.public_profiles?.display_name || l.seller_id.slice(0, 8)} ·{" "}
                    {new Date(l.created_at).toLocaleString()}
                  </p>
                  <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
                    {l.review_note || "Awaiting quality, legal and security review."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={busyId === l.id}
                    onClick={() =>
                      act(
                        l.id,
                        () =>
                          updateListing({
                            data: {
                              listing_id: l.id,
                              status: "rejected",
                              review_note:
                                window.prompt("Reason for rejection", "") || "Rejected by admin.",
                            },
                          }),
                        "Product rejected",
                      )
                    }
                  >
                    <X /> Reject
                  </Button>
                  <Button
                    disabled={busyId === l.id}
                    onClick={() =>
                      act(
                        l.id,
                        () =>
                          updateListing({
                            data: {
                              listing_id: l.id,
                              status: "active",
                              review_note: "Approved after admin review.",
                            },
                          }),
                        "Product approved",
                      )
                    }
                  >
                    <Check /> Approve
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
const SHIELD_RULES_VERSION = "1.0.0";

type ScanRow = {
  id: string;
  listing_id: string | null;
  asset_id: string | null;
  scanner: string;
  scanner_version: string | null;
  status: string;
  signature: string | null;
  findings: any;
  scanned_at: string;
};

function verdictOf(rows: ScanRow[]): { label: string; cls: string } {
  const s = rows.map((r) => r.status);
  if (s.includes("infected"))
    return { label: "DANGEROUS", cls: "bg-red-500/15 text-red-500" };
  if (s.some((x) => x === "incomplete" || x === "error"))
    return { label: "INCOMPLETE", cls: "bg-zinc-500/15 text-zinc-400" };
  if (s.includes("warning")) return { label: "WARNING", cls: "bg-amber-500/15 text-amber-500" };
  if (s.length > 0 && s.every((x) => x === "clean" || x === "overridden"))
    return {
      label: s.includes("overridden") ? "SAFE · REVIEWED" : "SAFE",
      cls: "bg-emerald-500/15 text-emerald-500",
    };
  return { label: "QUEUED", cls: "bg-sky-500/15 text-sky-500" };
}

const SEVERITY_CLS: Record<string, string> = {
  critical: "bg-red-500/15 text-red-500",
  high: "bg-orange-500/15 text-orange-500",
  medium: "bg-amber-500/15 text-amber-500",
  low: "bg-zinc-500/15 text-zinc-400",
  info: "bg-zinc-500/10 text-zinc-500",
};

function SecurityPanel({
  listings,
  updateListing,
}: {
  listings: any[];
  updateListing: any;
}) {
  const runQueue = useServerFn(runScanQueueNow);
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [loadingScans, setLoadingScans] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [queueNote, setQueueNote] = useState<string | null>(null);

  const loadScans = async () => {
    setLoadingScans(true);
    const { data, error } = await supabase
      .from("malware_scans")
      .select(
        "id,listing_id,asset_id,scanner,scanner_version,status,signature,findings,scanned_at",
      )
      .order("scanned_at", { ascending: false })
      .limit(300);
    if (error) toast.error(error.message);
    else setScans((data ?? []) as ScanRow[]);
    setLoadingScans(false);
  };
  useEffect(() => {
    void loadScans();
  }, []);

  // Latest scan per (listing, asset); rows arrive newest-first.
  const byListing = new Map<string, Map<string, ScanRow>>();
  for (const row of scans) {
    if (!row.listing_id || !row.asset_id) continue;
    if (!byListing.has(row.listing_id)) byListing.set(row.listing_id, new Map());
    const perAsset = byListing.get(row.listing_id)!;
    if (!perAsset.has(row.asset_id)) perAsset.set(row.asset_id, row);
  }
  const listingById = new Map(listings.map((l: any) => [l.id, l]));
  const groups = [...byListing.entries()]
    .map(([listingId, perAsset]) => ({
      listingId,
      listing: listingById.get(listingId),
      rows: [...perAsset.values()],
    }))
    .sort((a, b) => {
      const rank = (rows: ScanRow[]) =>
        rows.some((r) => r.status === "infected")
          ? 0
          : rows.some((r) => ["warning", "incomplete", "error"].includes(r.status))
            ? 1
            : 2;
      return rank(a.rows) - rank(b.rows);
    });

  const doBusy = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await loadScans();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Security scans — NORDEVA Shield" icon={<ShieldAlert />} count={groups.length}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-4">
        <Button
          size="sm"
          disabled={busy === "queue"}
          onClick={() =>
            doBusy(
              "queue",
              async () => {
                const r: any = await runQueue({ data: {} });
                setQueueNote(
                  !r?.configured
                    ? "Scanner service is not configured yet (MALWARE_SCANNER_URL / TOKEN missing)."
                    : `Queue processed — clean ${r.clean}, warning ${r.warning}, incomplete ${r.incomplete}, dangerous ${r.infected}, failed ${r.failed}.`,
                );
              },
              "Scan queue processed",
            )
          }
        >
          <RefreshCw /> Run scan queue now
        </Button>
        <Button size="sm" variant="outline" disabled={loadingScans} onClick={() => void loadScans()}>
          Refresh
        </Button>
        {queueNote && <span className="text-xs text-muted-foreground">{queueNote}</span>}
        <span className="ml-auto text-xs text-muted-foreground">
          Dangerous products are blocked and rejected automatically. Warning / incomplete scans
          hold publication until an admin reviews and overrides.
        </span>
      </div>
      {loadingScans ? (
        <Empty text="Loading scans…" />
      ) : groups.length === 0 ? (
        <Empty text="No scans yet. Scans are queued automatically when a seller uploads delivery files." />
      ) : (
        <div className="divide-y divide-border/40">
          {groups.map(({ listingId, listing, rows }) => {
            const verdict = verdictOf(rows);
            const filesTotal = rows.reduce(
              (n, r) => n + (Number(r.findings?.coverage?.files_total) || 0),
              0,
            );
            const filesInspected = rows.reduce(
              (n, r) => n + (Number(r.findings?.coverage?.files_inspected) || 0),
              0,
            );
            const suspiciousFiles = new Set<string>();
            for (const r of rows)
              for (const f of r.findings?.findings ?? [])
                if (f?.file && ["critical", "high", "medium"].includes(f.severity))
                  suspiciousFiles.add(f.file);
            const stale = rows.some(
              (r) =>
                ["clean", "warning", "infected", "incomplete"].includes(r.status) &&
                r.scanner_version !== SHIELD_RULES_VERSION,
            );
            const seller =
              listing?.public_profiles?.display_name ||
              listing?.public_profiles?.username ||
              (listing?.seller_id ? `${String(listing.seller_id).slice(0, 8)}…` : "—");
            const isOpen = expanded === listingId;
            return (
              <div key={listingId} className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wide ${verdict.cls}`}
                  >
                    {verdict.label}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {listing?.title || `Listing ${listingId.slice(0, 8)}…`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Seller {seller} · Listing status: {listing?.status ?? "unknown"} · Files
                      inspected {filesInspected}/{filesTotal} across {rows.length} asset
                      {rows.length === 1 ? "" : "s"}
                      {suspiciousFiles.size > 0
                        ? ` · ${suspiciousFiles.size} suspicious file${suspiciousFiles.size === 1 ? "" : "s"}`
                        : ""}
                      {stale ? " · Old scan rules — re-scan advised" : ""}
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setExpanded(isOpen ? null : listingId)}
                    >
                      {isOpen ? "Hide findings" : "Findings"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === `rescan-${listingId}`}
                      onClick={() =>
                        doBusy(
                          `rescan-${listingId}`,
                          async () => {
                            const { error } = await supabase.rpc("admin_rescan_listing", {
                              p_listing_id: listingId,
                            });
                            if (error) throw new Error(error.message);
                          },
                          "Re-scan queued",
                        )
                      }
                    >
                      Re-scan
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === `reject-${listingId}`}
                      onClick={() =>
                        doBusy(
                          `reject-${listingId}`,
                          () =>
                            updateListing({
                              data: {
                                listing_id: listingId,
                                status: "rejected",
                                review_note: "Rejected after security review.",
                              },
                            }),
                          "Product rejected",
                        )
                      }
                    >
                      <X /> Reject
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <div className="mt-3 space-y-3">
                    {rows.map((r) => {
                      const f = r.findings ?? {};
                      const items: any[] = Array.isArray(f.findings) ? f.findings : [];
                      const hold = ["warning", "incomplete", "error"].includes(r.status);
                      return (
                        <div
                          key={r.id}
                          className="rounded-md border border-border/50 bg-muted/20 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">asset {r.asset_id?.slice(0, 8)}…</span>
                            <span>
                              status <b className="text-foreground">{r.status}</b>
                            </span>
                            <span>rules {r.scanner_version ?? "legacy"}</span>
                            <span>{new Date(r.scanned_at).toLocaleString()}</span>
                            {r.signature && (
                              <span className="font-mono text-red-400">{r.signature}</span>
                            )}
                            {f.layers && (
                              <span>
                                layers: static {f.layers.static?.status ?? "?"}, signatures{" "}
                                {f.layers.signatures?.status ?? "?"}, dependencies{" "}
                                {f.layers.dependencies?.status ?? "?"}, sandbox{" "}
                                {f.layers.sandbox?.status ?? "?"}
                              </span>
                            )}
                            {hold && (
                              <Button
                                size="sm"
                                className="ml-auto"
                                disabled={busy === `override-${r.id}`}
                                onClick={() =>
                                  doBusy(
                                    `override-${r.id}`,
                                    async () => {
                                      const note =
                                        window.prompt(
                                          "Override note (why is this safe to publish?)",
                                          "",
                                        ) || "";
                                      const { error } = await supabase.rpc("admin_override_scan", {
                                        p_scan_id: r.id,
                                        p_note: note,
                                      });
                                      if (error) throw new Error(error.message);
                                    },
                                    "Hold overridden — listing can now be approved from Moderation",
                                  )
                                }
                              >
                                <Check /> Override hold
                              </Button>
                            )}
                          </div>
                          {f.admin_override && (
                            <div className="mt-1 text-xs text-emerald-500">
                              Reviewed by admin: {f.admin_override.note || "no note"} (
                              {new Date(f.admin_override.at).toLocaleString()})
                            </div>
                          )}
                          {Array.isArray(f.limits_hit) && f.limits_hit.length > 0 && (
                            <div className="mt-1 text-xs text-amber-500">
                              Limits hit: {f.limits_hit.join(", ")}
                            </div>
                          )}
                          {items.length === 0 ? (
                            <div className="mt-2 text-xs text-muted-foreground">
                              No findings recorded for this asset.
                            </div>
                          ) : (
                            <ul className="mt-2 space-y-1">
                              {items.slice(0, 50).map((it, i) => (
                                <li key={i} className="flex flex-wrap items-baseline gap-2 text-xs">
                                  <span
                                    className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase ${SEVERITY_CLS[it.severity] ?? SEVERITY_CLS.info}`}
                                  >
                                    {it.severity}
                                  </span>
                                  <span className="font-mono text-[11px]">{it.rule_id}</span>
                                  <span className="font-mono text-[11px] text-muted-foreground">
                                    {it.file ?? ""}
                                    {it.line ? `:${it.line}` : ""}
                                  </span>
                                  <span>{it.message}</span>
                                </li>
                              ))}
                              {items.length > 50 && (
                                <li className="text-xs text-muted-foreground">
                                  …and {items.length - 50} more findings
                                </li>
                              )}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
function Orders({ orders }: { orders: any[] }) {
  return (
    <Panel title="Orders & money" icon={<CircleDollarSign />} count={orders.length}>
      <Table headers={["Order", "Buyer", "Amount", "Fee", "Status", "Date"]}>
        {orders.map((o) => (
          <tr key={o.id} className="border-b border-border/40">
            <td className="p-3 font-mono text-[10px]">{o.id.slice(0, 10)}…</td>
            <td className="p-3 text-xs">{o.buyer_email || o.buyer_id?.slice(0, 10)}</td>
            <td className="p-3 text-sm">
              {o.currency} {Number(o.amount).toFixed(2)}
            </td>
            <td className="p-3 text-xs text-muted-foreground">
              {o.currency} {Number(o.platform_fee).toFixed(2)}
            </td>
            <td className="p-3">
              <Badge variant="outline">{o.status}</Badge>
            </td>
            <td className="p-3 text-xs text-muted-foreground">
              {new Date(o.created_at).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </Table>
    </Panel>
  );
}
/**
 * Custom website projects oversight: every website request with its
 * lifecycle status, package, client, assigned developer and proposal
 * count. Data arrives through getAdminCommandCenter (server-side admin
 * check); disputed projects are surfaced first because they need a human.
 */
function ProjectsPanel({
  projects,
  proposalCounts,
  users,
}: {
  projects: any[];
  proposalCounts: Record<string, number>;
  users: any[];
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const rows = projects as RequestLike[];
  const nameOf = (id: string | null | undefined) => {
    if (!id) return "—";
    const u = users.find((x: any) => x.id === id);
    return u?.display_name || u?.username || u?.email || `${id.slice(0, 8)}…`;
  };
  const disputed = rows.filter((r) => effectiveStatus(r) === "disputed");
  const presentStatuses = [...new Set(rows.map((r) => effectiveStatus(r)))];
  const visible =
    statusFilter === "all" ? rows : rows.filter((r) => effectiveStatus(r) === statusFilter);
  const statusBadge = (r: RequestLike) => {
    const s = effectiveStatus(r);
    const meta = PROJECT_STATUSES[s];
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${meta?.classes ?? "bg-muted text-muted-foreground"}`}
      >
        {meta?.label ?? s}
      </span>
    );
  };
  const projectLink = (r: RequestLike) => (
    <Link
      to="/projects/$id"
      params={{ id: r.id }}
      className="font-medium text-sm hover:text-lume hover:underline"
    >
      {r.title}
    </Link>
  );

  return (
    <div className="space-y-5">
      {disputed.length > 0 && (
        <section className="overflow-hidden rounded-[1.5rem] border border-red-500/40 bg-red-500/5">
          <div className="flex items-center gap-3 border-b border-red-500/30 p-5">
            <ShieldAlert className="size-5 text-red-400" />
            <div>
              <h2 className="font-semibold text-red-300">Disputed projects</h2>
              <div className="text-xs text-muted-foreground">
                {disputed.length} project{disputed.length === 1 ? "" : "s"} need admin attention —
                open the workspace to review the preserved history.
              </div>
            </div>
          </div>
          <div className="divide-y divide-red-500/20">
            {disputed.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  {projectLink(r)}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Client {nameOf(r.requester_id)} · Developer {nameOf(r.taken_by)} ·{" "}
                    {formatMoney(Number(r.budget), r.currency)}
                  </div>
                </div>
                {statusBadge(r)}
              </div>
            ))}
          </div>
        </section>
      )}

      <Panel title="Custom website projects" icon={<Briefcase />} count={visible.length}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {presentStatuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {PROJECT_STATUSES[s]?.label ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            Proposal counts exclude withdrawn proposals. Click a project to open its workspace.
          </span>
        </div>
        {visible.length === 0 ? (
          <Empty text="No project requests match this filter." />
        ) : (
          <Table
            headers={[
              "Project",
              "Status",
              "Package",
              "Budget",
              "Client",
              "Developer",
              "Proposals",
              "Created",
            ]}
          >
            {visible.map((r) => (
              <tr key={r.id} className="border-b border-border/40">
                <td className="max-w-56 p-3">
                  <span className="block truncate">{projectLink(r)}</span>
                </td>
                <td className="p-3">{statusBadge(r)}</td>
                <td className="p-3 text-xs text-muted-foreground">{packageBadgeLabel(r) ?? "—"}</td>
                <td className="p-3 text-sm">{formatMoney(Number(r.budget), r.currency)}</td>
                <td className="p-3 text-xs">{nameOf(r.requester_id)}</td>
                <td className="p-3 text-xs">{nameOf(r.taken_by)}</td>
                <td className="p-3 text-sm">{proposalCounts[r.id] ?? 0}</td>
                <td className="p-3 text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
function Sellers({
  data,
  busyId,
  act,
  updateVerification,
}: {
  data: AdminData;
  busyId: string | null;
  act: any;
  updateVerification: any;
}) {
  const pending = data.verifications.filter((x: any) => x.status === "pending");
  return (
    <Panel title="Seller trust & verification" icon={<ShieldCheck />} count={pending.length}>
      <div className="divide-y divide-border/60">
        {pending.length === 0 ? (
          <Empty text="No seller verification requests waiting." />
        ) : (
          pending.map((v: any) => (
            <div key={v.id} className="p-5 flex flex-wrap items-center gap-4">
              <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <UserCog />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{v.legal_name || v.user_id.slice(0, 12)}</div>
                <div className="text-xs text-muted-foreground">
                  {v.country_code || "Country not supplied"} · {v.tax_id || "Tax ID not supplied"} ·
                  requested {new Date(v.created_at).toLocaleDateString()}
                </div>
              </div>
              <Button
                variant="outline"
                disabled={busyId === v.id}
                onClick={() =>
                  act(
                    v.id,
                    () =>
                      updateVerification({
                        data: {
                          verification_id: v.id,
                          status: "rejected",
                          notes: "Verification requirements were not satisfied.",
                        },
                      }),
                    "Verification rejected",
                  )
                }
              >
                <X /> Reject
              </Button>
              <Button
                disabled={busyId === v.id}
                onClick={() =>
                  act(
                    v.id,
                    () =>
                      updateVerification({
                        data: {
                          verification_id: v.id,
                          status: "verified",
                          notes: "Approved by admin.",
                        },
                      }),
                    "Seller verified",
                  )
                }
              >
                <ShieldCheck /> Verify
              </Button>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
function Support({
  tickets,
  busyId,
  act,
  updateTicket,
}: {
  tickets: any[];
  busyId: string | null;
  act: any;
  updateTicket: any;
}) {
  const open = tickets.filter((x) => !["resolved", "closed"].includes(x.status));
  return (
    <Panel title="Customer support" icon={<Headphones />} count={open.length}>
      <div className="divide-y divide-border/60">
        {open.length === 0 ? (
          <Empty text="Support queue is clear." />
        ) : (
          open.map((t) => (
            <div key={t.id} className="p-5 flex flex-wrap items-center gap-4">
              <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <LifeBuoy />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.subject}</div>
                <div className="text-xs text-muted-foreground">
                  {t.category} · {t.priority} · {new Date(t.created_at).toLocaleString()}
                </div>
              </div>
              <Select
                defaultValue={t.status}
                onValueChange={(status) =>
                  act(
                    t.id,
                    () => updateTicket({ data: { ticket_id: t.id, status } }),
                    `Ticket ${status}`,
                  )
                }
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["open", "pending", "resolved", "closed"].map((x) => (
                    <SelectItem key={x} value={x}>
                      {x}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
function UsersPanel({
  users,
  busyId,
  act,
  updateUser,
}: {
  users: any[];
  busyId: string | null;
  act: any;
  updateUser: any;
}) {
  return (
    <Panel title="User management" icon={<Users />} count={users.length}>
      <Table headers={["User", "Email", "Joined", "Control"]}>
        {users.map((u) => (
          <tr key={u.id} className="border-b border-border/40">
            <td className="p-3">
              <div className="font-medium text-sm">{u.display_name || u.username || "Unnamed"}</div>
              <div className="font-mono text-[10px] text-muted-foreground">
                {u.id.slice(0, 12)}…
              </div>
            </td>
            <td className="p-3 text-xs">{u.email || "—"}</td>
            <td className="p-3 text-xs text-muted-foreground">
              {new Date(u.created_at).toLocaleDateString()}
            </td>
            <td className="p-3">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === u.id}
                  onClick={() =>
                    act(
                      u.id,
                      () =>
                        updateUser({
                          data: {
                            user_id: u.id,
                            state: "restricted",
                            note: "Restricted by admin.",
                          },
                        }),
                      "User restricted",
                    )
                  }
                >
                  Restrict
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busyId === u.id}
                  onClick={() =>
                    act(
                      u.id,
                      () =>
                        updateUser({
                          data: { user_id: u.id, state: "suspended", note: "Suspended by admin." },
                        }),
                      "User suspended",
                    )
                  }
                >
                  Suspend
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </Table>
    </Panel>
  );
}
function Reports({
  reports,
  users,
  listings,
  busyId,
  act,
  resolveReport,
}: {
  reports: any[];
  users: any[];
  listings: any[];
  busyId: string | null;
  act: any;
  resolveReport: any;
}) {
  const open = reports.filter((x) => x.status === "open");
  const userOf = (id: string | null | undefined) =>
    id ? users.find((x: any) => x.id === id) : undefined;
  const nameOf = (id: string | null | undefined) => {
    const u = userOf(id);
    if (!id) return "—";
    return u?.display_name || u?.username || u?.email || `${id.slice(0, 8)}…`;
  };
  const kindOf = (r: any): "listing" | "profile" | "message" =>
    r.message_id ? "message" : r.reported_user_id ? "profile" : "listing";
  const kindBadge = (r: any) => {
    const kind = kindOf(r);
    if (kind === "message")
      return (
        <Badge variant="secondary" className="gap-1">
          <MessageSquare className="size-3" /> Message
        </Badge>
      );
    if (kind === "profile")
      return (
        <Badge variant="secondary" className="gap-1">
          <Users className="size-3" /> Profile
        </Badge>
      );
    return (
      <Badge variant="secondary" className="gap-1">
        <ShoppingBag className="size-3" /> Listing
      </Badge>
    );
  };
  // Open reports first, then handled ones, newest first within each group.
  const sorted = [...reports].sort((a, b) => {
    const rank = (s: string) => (s === "open" ? 0 : 1);
    return (
      rank(a.status) - rank(b.status) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  });
  return (
    <Panel title="Reports & trust" icon={<Flag />} count={open.length}>
      <div className="divide-y divide-border/60">
        {sorted.length === 0 ? (
          <Empty text="No reports yet." />
        ) : (
          sorted.map((r) => {
            const kind = kindOf(r);
            const reportedUser = userOf(r.reported_user_id);
            const listing = r.listing_id
              ? listings.find((x: any) => x.id === r.listing_id)
              : undefined;
            const msg = r.target_message;
            const participants = msg?.conversation
              ? `${nameOf(msg.conversation.buyer_id)} and ${nameOf(msg.conversation.seller_id)}`
              : null;
            return (
              <div key={r.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {kindBadge(r)}
                    <span className="font-medium">{r.reason}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.status !== "open" ? <Badge variant="outline">{r.status}</Badge> : null}
                    <Badge variant="secondary">{new Date(r.created_at).toLocaleDateString()}</Badge>
                  </div>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {r.details || "No details provided."}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Reported by {nameOf(r.reporter_id)}
                </div>
                {kind === "listing" ? (
                  <div className="mt-2 text-sm">
                    Listing:{" "}
                    {r.listing_id ? (
                      <Link
                        to="/listing/$id"
                        params={{ id: r.listing_id }}
                        className="font-medium hover:text-lume hover:underline"
                      >
                        {listing?.title || `${r.listing_id.slice(0, 8)}…`}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </div>
                ) : null}
                {kind === "profile" ? (
                  <div className="mt-2 text-sm">
                    Reported profile:{" "}
                    {reportedUser?.username ? (
                      <Link
                        to="/creator/$username"
                        params={{ username: reportedUser.username }}
                        className="font-medium hover:text-lume hover:underline"
                      >
                        {reportedUser.display_name || reportedUser.username} (@
                        {reportedUser.username})
                      </Link>
                    ) : (
                      nameOf(r.reported_user_id)
                    )}
                  </div>
                ) : null}
                {kind === "message" && msg ? (
                  <div className="mt-2 rounded-xl bg-muted/50 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Reported message · from {nameOf(msg.sender_id)}
                      {participants ? ` · conversation between ${participants}` : ""}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">
                      {String(msg.body ?? "").length > 220
                        ? `${String(msg.body).slice(0, 220)}…`
                        : msg.body}
                    </p>
                  </div>
                ) : null}
                {r.status === "open" ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === r.id}
                      onClick={() =>
                        act(
                          r.id,
                          () => resolveReport({ data: { report_id: r.id, status: "dismissed" } }),
                          "Report dismissed",
                        )
                      }
                    >
                      <X /> Dismiss
                    </Button>
                    <Button
                      size="sm"
                      disabled={busyId === r.id}
                      onClick={() =>
                        act(
                          r.id,
                          () => resolveReport({ data: { report_id: r.id, status: "resolved" } }),
                          "Report resolved",
                        )
                      }
                    >
                      <Check /> Resolve
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

const DISPUTE_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  resolved_buyer: "Resolved for buyer",
  resolved_developer: "Resolved for developer",
  resolved_partial: "Resolved partially",
  closed: "Closed",
};

function DisputesPanel({
  disputes,
  projects,
  users,
  busyId,
  act,
  resolveDispute,
}: {
  disputes: any[];
  projects: any[];
  users: any[];
  busyId: string | null;
  act: any;
  resolveDispute: any;
}) {
  const openCount = disputes.filter((x) => x.status === "open").length;
  const nameOf = (id: string | null | undefined) => {
    if (!id) return "—";
    const u = users.find((x: any) => x.id === id);
    return u?.display_name || u?.username || u?.email || `${id.slice(0, 8)}…`;
  };
  // Open disputes first, then resolved ones, newest first within each.
  const sorted = [...disputes].sort((a, b) => {
    const rank = (s: string) => (s === "open" ? 0 : 1);
    return (
      rank(a.status) - rank(b.status) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  });
  return (
    <Panel title="Project disputes" icon={<ShieldAlert />} count={openCount}>
      {sorted.length === 0 ? (
        <Empty text="No disputes have been raised." />
      ) : (
        <div className="divide-y divide-border/60">
          {sorted.map((x) => (
            <DisputeRow
              key={x.id}
              dispute={x}
              project={projects.find((p: any) => p.id === x.project_id)}
              nameOf={nameOf}
              busyId={busyId}
              act={act}
              resolveDispute={resolveDispute}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function DisputeRow({
  dispute: x,
  project,
  nameOf,
  busyId,
  act,
  resolveDispute,
}: {
  dispute: any;
  project: any;
  nameOf: (id: string | null | undefined) => string;
  busyId: string | null;
  act: any;
  resolveDispute: any;
}) {
  const [note, setNote] = useState("");
  const [moveProject, setMoveProject] = useState(true);
  const payment = x.payment;
  const resolve = (
    status: "resolved_buyer" | "resolved_developer" | "resolved_partial" | "closed",
  ) => {
    if (status === "resolved_partial" && !note.trim()) {
      toast.error("Add a note explaining the partial resolution");
      return;
    }
    const moveTo =
      moveProject && status === "resolved_buyer"
        ? "cancelled"
        : moveProject && status === "resolved_developer"
          ? "completed"
          : "none";
    act(
      x.id,
      async () => {
        await resolveDispute({
          data: {
            dispute_id: x.id,
            status,
            admin_note: note.trim() || undefined,
            move_project_to: moveTo,
          },
        });
        if (moveTo !== "none") {
          // The transition graph already allows admins disputed → cancelled
          // and disputed → completed; the RPC stays the single validator.
          const { error } = await supabase.rpc("transition_project_status", {
            p_request_id: x.project_id,
            p_status: moveTo,
          });
          if (error)
            toast.warning(
              `Dispute resolved, but the project status could not be moved: ${error.message}`,
            );
        }
      },
      "Dispute resolved",
    );
  };
  return (
    <div className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {project ? (
            <Link
              to="/projects/$id"
              params={{ id: project.id }}
              className="font-medium hover:text-lume hover:underline"
            >
              {project.title}
            </Link>
          ) : (
            <span className="font-medium">Project {x.project_id.slice(0, 8)}…</span>
          )}
          <div className="mt-0.5 text-xs text-muted-foreground">
            Raised by {nameOf(x.raised_by)} · Client {nameOf(project?.requester_id)} · Developer{" "}
            {nameOf(project?.taken_by)} · {new Date(x.created_at).toLocaleDateString()}
          </div>
        </div>
        <Badge variant={x.status === "open" ? "destructive" : "outline"}>
          {DISPUTE_STATUS_LABELS[x.status] ?? x.status}
        </Badge>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{x.reason}</p>
      {payment ? (
        <div className="mt-2 text-sm">
          Project payment: <span className="font-medium">{payment.status}</span> ·{" "}
          {formatMoney(Number(payment.amount), payment.currency)}
          {payment.status === "paid" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              This payment was captured by Stripe. Project-payment refunds are issued from the
              Stripe dashboard — when Stripe processes a refund, the payment and project status
              update here automatically.
            </p>
          ) : null}
        </div>
      ) : null}
      {x.status !== "open" ? (
        <div className="mt-2 text-xs text-muted-foreground">
          {x.admin_note ? <>Admin note: {x.admin_note} · </> : null}
          Resolved {x.resolved_at ? new Date(x.resolved_at).toLocaleString() : ""}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Admin note (required for a partial resolution)"
            className="min-h-16"
            maxLength={1000}
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={moveProject}
              onChange={(e) => setMoveProject(e.target.checked)}
              className="size-4 accent-current"
            />
            Also update the project status — for the buyer: Cancelled; for the developer: Completed
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busyId === x.id} onClick={() => resolve("resolved_buyer")}>
              Resolve for buyer
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busyId === x.id}
              onClick={() => resolve("resolved_developer")}
            >
              Resolve for developer
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busyId === x.id}
              onClick={() => resolve("resolved_partial")}
            >
              Resolve partial
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busyId === x.id}
              onClick={() => resolve("closed")}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
function Analytics({ events }: { events: any[] }) {
  const grouped = events.reduce((a: any, e: any) => {
    a[e.event_name] = (a[e.event_name] || 0) + 1;
    return a;
  }, {});
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <Panel title="Event volume" icon={<BarChart3 />} count={events.length}>
        <div className="space-y-3">
          {Object.entries(grouped)
            .sort((a: any, b: any) => b[1] - a[1])
            .slice(0, 20)
            .map(([k, v]: any) => (
              <div key={k}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{k}</span>
                  <span>{v}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.min(100, (v / Math.max(...(Object.values(grouped) as number[]))) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
        </div>
      </Panel>
      <Panel title="Recent acquisition events" icon={<BarChart3 />}>
        <Table headers={["Event", "Source", "Medium", "Date"]}>
          {events.slice(0, 50).map((e: any) => (
            <tr key={e.id} className="border-b border-border/40">
              <td className="p-3 text-xs">{e.event_name}</td>
              <td className="p-3 text-xs">{e.utm_source || "direct"}</td>
              <td className="p-3 text-xs">{e.utm_medium || "—"}</td>
              <td className="p-3 text-xs text-muted-foreground">
                {new Date(e.created_at).toLocaleString()}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
function Tasks({
  tasks,
  busyId,
  act,
  createTask,
}: {
  tasks: any[];
  busyId: string | null;
  act: any;
  createTask: any;
}) {
  const add = () =>
    act(
      "new-task",
      () =>
        createTask({
          data: {
            task_type: "security",
            title: "Review marketplace security queue",
            priority: "high",
          },
        }),
      "Task created",
    );
  return (
    <Panel
      title="Operations task board"
      icon={<ListChecks />}
      count={tasks.filter((x) => x.status === "open").length}
    >
      <div className="mb-4 flex justify-end">
        <Button onClick={add} disabled={busyId === "new-task"}>
          <ListChecks /> Create security task
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {tasks.map((t) => (
          <div key={t.id} className="rounded-2xl border p-4">
            <div className="flex items-center justify-between">
              <Badge variant="outline">{t.priority}</Badge>
              <span className="text-[10px] text-muted-foreground">{t.task_type}</span>
            </div>
            <div className="mt-3 font-medium">{t.title}</div>
            <div className="mt-2 text-xs text-muted-foreground">
              {t.status} · {new Date(t.created_at).toLocaleString()}
            </div>
          </div>
        ))}
        {tasks.length === 0 && <Empty text="No admin tasks yet." />}
      </div>
    </Panel>
  );
}
/**
 * Category management for the admin-managed `categories` table.
 * Writes go through the database's admin-only RLS policy on categories
 * (the same gating as the rest of this page: the page itself only loads
 * for admins via getAdminCommandCenter). Listings reference categories by
 * free-text name, so delete is only allowed for categories no listing
 * uses — deactivation is the safe path for everything else. Renames keep
 * the original slug so stored references stay stable.
 */
function CategoriesPanel() {
  type CategoryRow = {
    id: string;
    name: string;
    slug: string;
    sort_order: number;
    is_active: boolean;
  };
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("categories")
      .select("id,name,slug,sort_order,is_active")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      setUnavailable(true);
      setRows([]);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as CategoryRow[]);
    const { data: listingCats } = await supabase.from("listings").select("category");
    const counts: Record<string, number> = {};
    for (const l of listingCats ?? []) {
      if (l.category) {
        const key = l.category.trim().toLowerCase();
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    setUsage(counts);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const slugify = (name: string) =>
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const add = async () => {
    const name = newName.trim();
    if (!name) return toast.error("Enter a category name");
    const slug = slugify(name);
    if (!slug) return toast.error("Category name needs letters or numbers");
    setBusyId("new");
    const nextOrder = rows.reduce((max, r) => Math.max(max, r.sort_order), 0) + 1;
    const { error } = await supabase
      .from("categories")
      .insert({ name, slug, sort_order: nextOrder });
    setBusyId(null);
    if (error) return toast.error(error.message);
    setNewName("");
    toast.success("Category added");
    await load();
  };

  const rename = async (row: CategoryRow) => {
    const name = editName.trim();
    if (!name) return toast.error("Category name can't be empty");
    if (name === row.name) {
      setEditingId(null);
      return;
    }
    setBusyId(row.id);
    const { error } = await supabase.from("categories").update({ name }).eq("id", row.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    setEditingId(null);
    toast.success("Category renamed — listings keep their original category text until edited");
    await load();
  };

  const toggleActive = async (row: CategoryRow) => {
    setBusyId(row.id);
    const { error } = await supabase
      .from("categories")
      .update({ is_active: !row.is_active })
      .eq("id", row.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(row.is_active ? "Category deactivated" : "Category activated");
    await load();
  };

  const remove = async (row: CategoryRow) => {
    const used = usage[row.name.trim().toLowerCase()] ?? 0;
    if (used > 0)
      return toast.error(
        `“${row.name}” is used by ${used} listing${used === 1 ? "" : "s"} — deactivate it instead of deleting`,
      );
    if (!window.confirm(`Delete the unused category “${row.name}”?`)) return;
    setBusyId(row.id);
    const { error } = await supabase.from("categories").delete().eq("id", row.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Category deleted");
    await load();
  };

  if (unavailable) {
    return (
      <Panel title="Categories" icon={<Tags className="size-5" />}>
        <Empty text="Categories will be available once the latest NORDEVA database update is applied." />
      </Panel>
    );
  }

  return (
    <Panel title="Categories" icon={<Tags className="size-5" />} count={rows.length}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-4">
        <Input
          className="w-64"
          placeholder="New category name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
        />
        <Button size="sm" onClick={() => void add()} disabled={busyId === "new"}>
          Add category
        </Button>
        <span className="text-xs text-muted-foreground">
          Active categories appear in Browse filters and the listing form. Deactivate instead of
          deleting categories that listings already use.
        </span>
      </div>
      {loading ? (
        <Empty text="Loading categories…" />
      ) : rows.length === 0 ? (
        <Empty text="No categories yet." />
      ) : (
        <Table headers={["Name", "Slug", "Listings", "Status", "Actions"]}>
          {rows.map((row) => {
            const used = usage[row.name.trim().toLowerCase()] ?? 0;
            return (
              <tr key={row.id} className="border-t border-border/60">
                <td className="p-3 text-sm">
                  {editingId === row.id ? (
                    <Input
                      className="w-52"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void rename(row);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span className="font-medium">{row.name}</span>
                  )}
                </td>
                <td className="p-3 text-xs text-muted-foreground">{row.slug}</td>
                <td className="p-3 text-sm">{used}</td>
                <td className="p-3">
                  <Badge variant={row.is_active ? "default" : "secondary"}>
                    {row.is_active ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {editingId === row.id ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => void rename(row)}
                          disabled={busyId === row.id}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(row.id);
                          setEditName(row.name);
                        }}
                      >
                        Rename
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void toggleActive(row)}
                      disabled={busyId === row.id}
                    >
                      {row.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void remove(row)}
                      disabled={busyId === row.id}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </Panel>
  );
}

function DesignPanel() {
  const getAppearanceFn = useServerFn(getAppearance);
  const saveAppearanceFn = useServerFn(saveAppearance);
  const [config, setConfig] = useState<AppearanceConfig>(DEFAULT_APPEARANCE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getAppearanceFn()
      .then((cfg) => {
        if (active) setConfig(validateAppearance(cfg));
      })
      .catch(() => {
        if (active) toast.error("Design settings could not be loaded — showing defaults");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const patch = (p: Partial<AppearanceConfig>) => setConfig((c) => ({ ...c, ...p }));
  const patchBanner = (p: Partial<PromoBannerConfig>) =>
    setConfig((c) => ({ ...c, promoBanner: { ...c.promoBanner, ...p } }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveAppearanceFn({ data: { config } });
      setConfig(res.config);
      cacheAppearance(res.config);
      applyAppearance(res.config);
      setSavedAt(new Date().toLocaleTimeString());
      toast.success("Design settings saved — live for every visitor");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Design settings could not be saved");
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <Panel title="Design settings" icon={<Palette className="size-5" />}>
        <div className="p-10 text-center">
          <Loader2 className="mx-auto size-6 animate-spin text-lume" />
          <p className="mt-3 text-sm text-muted-foreground">Loading design settings…</p>
        </div>
      </Panel>
    );

  const banner = config.promoBanner;
  const hue = config.accentHue ?? 190;
  const fieldLabel = "text-xs font-medium uppercase tracking-wider text-muted-foreground";

  return (
    <Panel title="Design settings" icon={<Palette className="size-5" />}>
      <div className="space-y-8 p-5">
        <p className="text-sm text-muted-foreground">
          Site-wide appearance for every visitor. The preset, accent and banner apply as soon as you
          save; card variant, grid density and content width are stored here and adopted by
          marketplace surfaces as the redesign rolls out. Visitors keep their own light/dark choice
          on top of the preset.
        </p>

        <section>
          <h3 className="font-medium">Appearance preset</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {APPEARANCE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => patch({ preset: preset.id })}
                aria-pressed={config.preset === preset.id}
                className={`rounded-2xl border p-4 text-left transition ${
                  config.preset === preset.id
                    ? "border-primary ring-2 ring-ring/40"
                    : "border-border/60 hover:border-border"
                }`}
              >
                <span className="flex gap-1.5">
                  {preset.swatches.map((s) => (
                    <span
                      key={s}
                      className="size-5 rounded-full border border-black/10"
                      style={{ background: s }}
                    />
                  ))}
                </span>
                <span className="mt-3 block font-medium">{preset.label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {preset.blurb}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="font-medium">Layout & cards</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <label className={fieldLabel}>Product card variant</label>
              <Select
                value={config.cardVariant}
                onValueChange={(v) => patch({ cardVariant: v as AppearanceConfig["cardVariant"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                  <SelectItem value="featured">Featured</SelectItem>
                  <SelectItem value="horizontal">Horizontal</SelectItem>
                  <SelectItem value="editorial">Editorial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className={fieldLabel}>Grid density</label>
              <Select
                value={config.gridDensity}
                onValueChange={(v) => patch({ gridDensity: v as AppearanceConfig["gridDensity"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comfortable">Comfortable</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className={fieldLabel}>Content width</label>
              <Select
                value={config.contentWidth}
                onValueChange={(v) =>
                  patch({ contentWidth: v as AppearanceConfig["contentWidth"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="wide">Wide</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-medium">Custom accent hue</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Optional — rotates the preset accent to any hue. Off uses the preset accent.
              </p>
            </div>
            <Switch
              checked={config.accentHue !== null}
              onCheckedChange={(on) => patch({ accentHue: on ? hue : null })}
            />
          </div>
          {config.accentHue !== null && (
            <div className="mt-4 flex items-center gap-4">
              <span
                className="size-8 shrink-0 rounded-full border border-black/10"
                style={{ background: `oklch(0.6 0.13 ${hue})` }}
              />
              <Slider
                value={[hue]}
                min={0}
                max={360}
                step={1}
                onValueChange={([v]) => patch({ accentHue: v })}
                className="flex-1"
              />
              <span className="w-14 text-right text-sm tabular-nums">{hue}°</span>
              <Button variant="outline" size="sm" onClick={() => patch({ accentHue: null })}>
                Reset
              </Button>
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-medium">Promotional banner</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Shown on the homepage. It renders once it has a heading.
              </p>
            </div>
            <Switch
              checked={banner.enabled}
              onCheckedChange={(on) => patchBanner({ enabled: on })}
            />
          </div>
          {banner.enabled && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className={fieldLabel}>Label (optional)</label>
                <Input
                  value={banner.label}
                  maxLength={60}
                  placeholder="e.g. Launch week"
                  onChange={(e) => patchBanner({ label: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className={fieldLabel}>Heading</label>
                <Input
                  value={banner.heading}
                  maxLength={140}
                  placeholder="e.g. New templates every Friday"
                  onChange={(e) => patchBanner({ heading: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className={fieldLabel}>Description (optional)</label>
                <Textarea
                  value={banner.description}
                  maxLength={320}
                  rows={2}
                  placeholder="One short line of supporting copy."
                  onChange={(e) => patchBanner({ description: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className={fieldLabel}>Button label</label>
                <Input
                  value={banner.ctaLabel}
                  maxLength={60}
                  placeholder="Browse new items"
                  onChange={(e) => patchBanner({ ctaLabel: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className={fieldLabel}>Button link</label>
                <Input
                  value={banner.ctaHref}
                  maxLength={300}
                  placeholder="/browse"
                  onChange={(e) => patchBanner({ ctaHref: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className={fieldLabel}>Background</label>
                <Select
                  value={banner.bg}
                  onValueChange={(v) => patchBanner({ bg: v as PromoBannerConfig["bg"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="accent">Brand accent</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {banner.bg === "image" && (
                <div className="space-y-2">
                  <label className={fieldLabel}>Image URL</label>
                  <Input
                    value={banner.imageUrl}
                    maxLength={500}
                    placeholder="https://…"
                    onChange={(e) => patchBanner({ imageUrl: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-5">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save design settings
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              applyAppearance(config);
              toast.success("Preview applied on this device only — save to publish");
            }}
          >
            Preview on this device
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setConfig(DEFAULT_APPEARANCE);
              setSavedAt(null);
            }}
          >
            Reset to defaults
          </Button>
          {savedAt && <span className="text-xs text-muted-foreground">Saved at {savedAt}</span>}
        </div>
      </div>
    </Panel>
  );
}

function Panel({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/60 p-5">
        <div className="flex items-center gap-3">
          <div className="text-lume">{icon}</div>
          <div>
            <h2 className="font-semibold">{title}</h2>
            {count !== undefined && (
              <div className="text-xs text-muted-foreground">{count} records</div>
            )}
          </div>
        </div>
        <LockKeyhole className="size-4 text-muted-foreground" />
      </div>
      {children}
    </section>
  );
}
function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="bg-muted/30">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="p-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="p-10 text-center text-sm text-muted-foreground">{text}</div>;
}
