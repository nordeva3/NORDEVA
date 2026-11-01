import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getAdminOverview,
  moderateListing,
  resolvePayout,
  resolveReport,
  resolveRefundRequest,
} from "@/lib/admin.functions";
import { useServerFn } from "@tanstack/react-start";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar } from "@/components/ui-kit";
import { formatMoney } from "@/lib/currencies";
import {
  Plus,
  Trash2,
  ShieldCheck,
  Users,
  Flag,
  WalletCards,
  Check,
  X,
  Briefcase,
  ExternalLink,
  LayoutDashboard,
  LayoutGrid,
  Palette,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { MarketplaceSuite } from "@/components/marketplace-suite";
import { DashboardProjects } from "@/components/dashboard-projects";
import { ProfileEditor } from "@/components/profile-editor";
import { ProfileCompletionWidget } from "@/components/profile-completion-widget";
import { AppearanceSettingsDialog } from "@/components/appearance-settings";
import { adminExecutePayout, adminExecuteRefund } from "@/lib/admin.functions";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    rejected: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  const cls = styles[status] ?? "bg-muted text-muted-foreground border-border";
  const label = status === "active" ? "Live" : status === "pending" ? "Under review" : status;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

/* Sidebar layout (redesign wave R6): the sidebar items map 1:1 to the
   sections this page has always rendered — Overview holds the listings and
   recent-sales blocks, the rest are the existing DashboardProjects,
   MarketplaceSuite, ProfileEditor and admin control-center blocks. */
type DashboardSection = "overview" | "projects" | "suite" | "profile" | "admin";

type SidebarProfile = {
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
} | null;

const DASHBOARD_SECTIONS: {
  id: DashboardSection;
  label: string;
  icon: typeof LayoutDashboard;
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "projects", label: "Projects", icon: Briefcase },
  { id: "suite", label: "Marketplace Suite", icon: LayoutGrid },
  { id: "profile", label: "Your profile", icon: UserRound },
  { id: "admin", label: "Admin control center", icon: ShieldCheck },
];

function DashboardSidebar({
  section,
  onSelect,
  isAdmin,
  profile,
}: {
  section: DashboardSection;
  onSelect: (section: DashboardSection) => void;
  isAdmin: boolean;
  profile: SidebarProfile;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const select = (id: DashboardSection) => {
    onSelect(id);
    if (isMobile) setOpenMobile(false);
  };
  const name = profile?.display_name ?? profile?.username ?? "Your account";
  const identity = (
    <>
      <Avatar name={name} url={profile?.avatar_url} size={32} />
      <span className="grid flex-1 text-left leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {profile?.username ? `@${profile.username}` : "Seller dashboard"}
        </span>
      </span>
    </>
  );
  return (
    <Sidebar collapsible="icon" style={{ top: "4rem", height: "calc(100svh - 4rem)" }}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {profile?.username ? (
              <SidebarMenuButton size="lg" asChild tooltip={name}>
                <Link to="/creator/$username" params={{ username: profile.username }}>
                  {identity}
                </Link>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton size="lg" tooltip={name}>
                {identity}
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {DASHBOARD_SECTIONS.filter((s) => s.id !== "admin" || isAdmin).map(
              ({ id, label, icon: Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    isActive={section === id}
                    onClick={() => select(id)}
                    tooltip={label}
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ),
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {profile?.username && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="View public profile">
                <Link to="/creator/$username" params={{ username: profile.username }}>
                  <ExternalLink />
                  <span>View public profile</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Appearance" onClick={() => setAppearanceOpen(true)}>
              <Palette />
              <span>Appearance</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
      <AppearanceSettingsDialog open={appearanceOpen} onOpenChange={setAppearanceOpen} />
    </Sidebar>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [listings, setListings] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileRefresh, setProfileRefresh] = useState(0);
  const [section, setSection] = useState<DashboardSection>("overview");
  const [profile, setProfile] = useState<SidebarProfile>(null);
  const [adminData, setAdminData] = useState<any>(null);
  const getAdmin = useServerFn(getAdminOverview);
  const moderate = useServerFn(moderateListing);
  const resolveReportFn = useServerFn(resolveReport);
  const resolvePayoutFn = useServerFn(resolvePayout);
  const resolveRefundFn = useServerFn(resolveRefundRequest);
  const executePayoutFn = useServerFn(adminExecutePayout);
  const executeRefundFn = useServerFn(adminExecuteRefund);

  const load = async (uid: string) => {
    const [{ data: ls }, { data: os }] = await Promise.all([
      supabase
        .from("listings")
        .select("*")
        .eq("seller_id", uid)
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select("*, listings(title)")
        .eq("seller_id", uid)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    setListings(ls ?? []);
    setOrders(os ?? []);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        navigate({ to: "/auth", search: { next: "/dashboard" } });
      } else {
        setUserId(data.user.id);
        // Display-only identity for the sidebar header (name / avatar /
        // public-profile link); no existing query or flow depends on it.
        supabase
          .from("profiles")
          .select("display_name, username, avatar_url")
          .eq("id", data.user.id)
          .maybeSingle()
          .then(({ data: p }) => setProfile(p));
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", data.user.id)
          .eq("role", "admin")
          .maybeSingle();
        const admin = !!roles;
        setIsAdmin(admin);
        await load(data.user.id);
        if (admin) {
          try {
            setAdminData(await getAdmin({ data: {} }));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not load admin controls");
          }
        }
      }
    });
  }, [navigate]);

  const del = async (id: string) => {
    if (!isAdmin) return toast.error("Only admins can remove listings");
    const { error } = await supabase.from("listings").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Listing removed");
    if (userId) load(userId);
  };

  if (!userId) return null;

  return (
    <div className="min-h-screen">
      <TopNav />
      <SidebarProvider className="min-h-0">
        <DashboardSidebar
          section={section}
          onSelect={setSection}
          isAdmin={isAdmin}
          profile={profile}
        />
        <SidebarInset className="min-w-0">
          <div className="mx-auto w-full max-w-6xl px-4 py-10">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <SidebarTrigger />
                <h1 className="text-3xl font-semibold">Seller dashboard</h1>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <Button asChild variant="outline">
                    <Link to="/admin">
                      <ShieldCheck className="size-4 mr-1" /> Admin 2.0
                    </Link>
                  </Button>
                )}
                <Button asChild className="lume-gradient text-white hover:opacity-90">
                  <Link to="/sell">
                    <Plus className="size-4 mr-1" /> New listing
                  </Link>
                </Button>
              </div>
            </div>

            <ProfileCompletionWidget userId={userId} refreshKey={profileRefresh} />

            {section === "projects" && <DashboardProjects userId={userId} />}

            {section === "overview" && (
              <>
                <section>
                  <h2 className="text-lg font-medium mb-3">Your listings</h2>
                  {loading ? null : listings.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center text-muted-foreground">
                      No listings yet.{" "}
                      <Link to="/sell" className="text-lume underline">
                        Create your first one
                      </Link>
                      .
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-border/60 bg-card divide-y divide-border/60">
                      {listings.map((l) => (
                        <div key={l.id} className="p-4 flex items-center gap-4">
                          <div className="w-16 h-10 rounded bg-muted overflow-hidden shrink-0">
                            {l.cover_url ? (
                              <img src={l.cover_url} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full lume-gradient opacity-30" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <Link
                              to="/listing/$id"
                              params={{ id: l.id }}
                              className="font-medium hover:underline block truncate"
                            >
                              {l.title}
                            </Link>
                            <div className="text-xs text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                              <span>{l.kind}</span>
                              <StatusBadge status={l.status} />
                            </div>
                          </div>
                          <div className="text-sm lume-text font-medium">
                            {formatMoney(Number(l.price), l.currency)}
                          </div>
                          {isAdmin && (
                            <button
                              onClick={() => del(l.id)}
                              className="text-muted-foreground hover:text-destructive p-2"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="mt-10">
                  <h2 className="text-lg font-medium mb-3">Recent sales</h2>
                  {orders.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center text-muted-foreground text-sm">
                      No sales yet.
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-border/60 bg-card divide-y divide-border/60">
                      {orders.map((o) => (
                        <div key={o.id} className="p-4 flex items-center gap-4 text-sm">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">
                              {o.listings?.title ?? "Listing"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {o.buyer_email} · {new Date(o.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="lume-text font-medium">
                              +{formatMoney(Number(o.seller_earnings), o.currency)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              of {formatMoney(Number(o.amount), o.currency)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            {section === "suite" && <MarketplaceSuite userId={userId} listings={listings} />}

            {section === "profile" && (
              <ProfileEditor userId={userId} onSaved={() => setProfileRefresh((n) => n + 1)} />
            )}

            {section === "admin" && isAdmin && adminData && (
              <section className="mt-12 space-y-6">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-5 text-gold" />
                    <h2 className="text-xl font-semibold">Admin control center</h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Moderate listings, inspect users, review marketplace reports, and track the 15%
                    platform fee.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    ["Users", adminData.users.length, Users],
                    [
                      "Pending listings",
                      adminData.listings.filter((x: any) => x.status === "pending").length,
                      ShieldCheck,
                    ],
                    [
                      "Reports",
                      adminData.reports.filter((x: any) => x.status === "open").length,
                      Flag,
                    ],
                    [
                      "Orders",
                      adminData.orders.filter((x: any) => x.status === "completed").length,
                      WalletCards,
                    ],
                    [
                      "Refunds",
                      adminData.refunds.filter(
                        (x: any) => !["rejected", "resolved"].includes(x.status),
                      ).length,
                      Flag,
                    ],
                  ].map(([label, value, Icon]: any) => (
                    <div key={label} className="surface p-4">
                      <Icon className="size-4 text-lume" />
                      <div className="mt-3 text-2xl font-semibold">{value}</div>
                      <div className="text-xs text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>

                <div className="surface overflow-hidden">
                  <div className="border-b border-border/60 p-5">
                    <h3 className="font-medium">Moderation queue</h3>
                  </div>
                  <div className="divide-y divide-border/60">
                    {adminData.listings.filter((x: any) => x.status === "pending").length === 0 ? (
                      <div className="p-6 text-sm text-muted-foreground">
                        No listings waiting for review.
                      </div>
                    ) : (
                      adminData.listings
                        .filter((x: any) => x.status === "pending")
                        .map((l: any) => (
                          <div key={l.id} className="p-5 flex flex-wrap items-center gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate">{l.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {l.kind} ·{" "}
                                {l.public_profiles?.display_name ??
                                  l.public_profiles?.username ??
                                  "Seller"}{" "}
                                · {formatMoney(Number(l.price), l.currency)}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={async () => {
                                  try {
                                    await moderate({
                                      data: {
                                        listing_id: l.id,
                                        status: "active",
                                        review_note: "Approved by admin.",
                                      },
                                    });
                                    setAdminData(await getAdmin({ data: {} }));
                                    toast.success("Listing approved");
                                  } catch (err) {
                                    toast.error(
                                      err instanceof Error ? err.message : "Approval failed",
                                    );
                                  }
                                }}
                              >
                                <Check className="mr-1 size-4" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={async () => {
                                  try {
                                    await moderate({
                                      data: {
                                        listing_id: l.id,
                                        status: "rejected",
                                        review_note: "Rejected by admin.",
                                      },
                                    });
                                    setAdminData(await getAdmin({ data: {} }));
                                    toast.success("Listing rejected");
                                  } catch (err) {
                                    toast.error(
                                      err instanceof Error ? err.message : "Rejection failed",
                                    );
                                  }
                                }}
                              >
                                <X className="mr-1 size-4" /> Reject
                              </Button>
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="surface overflow-hidden">
                    <div className="border-b border-border/60 p-5">
                      <h3 className="font-medium">Users</h3>
                    </div>
                    <div className="max-h-72 divide-y divide-border/60 overflow-auto">
                      {adminData.users.map((u: any) => (
                        <div key={u.id} className="p-4 text-sm">
                          <div className="font-medium">
                            {u.display_name ?? u.username ?? "User"}
                          </div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="surface overflow-hidden">
                    <div className="border-b border-border/60 p-5">
                      <h3 className="font-medium">Commission tracking</h3>
                    </div>
                    <div className="max-h-72 divide-y divide-border/60 overflow-auto">
                      {adminData.orders.map((o: any, i: number) => (
                        <div key={i} className="p-4 flex justify-between gap-4 text-sm">
                          <span>{new Date(o.created_at).toLocaleDateString()}</span>
                          <span className="lume-text font-medium">
                            +{formatMoney(Number(o.platform_fee), o.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="surface overflow-hidden">
                  <div className="border-b border-border/60 p-5 flex items-center justify-between">
                    <h3 className="font-medium">Refund & dispute queue</h3>
                    <span className="text-xs text-muted-foreground">
                      Provider refunds can be automated when the Razorpay server credentials are
                      configured.
                    </span>
                  </div>
                  <div className="max-h-80 divide-y divide-border/60 overflow-auto">
                    {adminData.refunds.filter(
                      (r: any) => !["rejected", "resolved"].includes(r.status),
                    ).length === 0 ? (
                      <div className="p-5 text-sm text-muted-foreground">
                        No open refund requests.
                      </div>
                    ) : (
                      adminData.refunds
                        .filter((r: any) => !["rejected", "resolved"].includes(r.status))
                        .map((r: any) => (
                          <div key={r.id} className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium">{r.reason}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  Order {r.order_id}
                                </div>
                              </div>
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                {r.status}
                              </span>
                            </div>
                            {r.details && (
                              <div className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">
                                {r.details}
                              </div>
                            )}
                            <div className="mt-3 flex gap-2 flex-wrap">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    await resolveRefundFn({
                                      data: {
                                        refund_id: r.id,
                                        status: "under_review",
                                        admin_note: "Under review by NORDEVA.",
                                      },
                                    });
                                    setAdminData(await getAdmin({ data: {} }));
                                    toast.success("Refund moved to review");
                                  } catch (e) {
                                    toast.error(
                                      e instanceof Error ? e.message : "Could not update refund",
                                    );
                                  }
                                }}
                              >
                                Review
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  const note =
                                    window.prompt("Reason for rejecting this request:", "") ?? "";
                                  try {
                                    await resolveRefundFn({
                                      data: {
                                        refund_id: r.id,
                                        status: "rejected",
                                        admin_note: note || "Request rejected by admin.",
                                      },
                                    });
                                    setAdminData(await getAdmin({ data: {} }));
                                    toast.success("Refund request rejected");
                                  } catch (e) {
                                    toast.error(
                                      e instanceof Error ? e.message : "Could not update refund",
                                    );
                                  }
                                }}
                              >
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                onClick={async () => {
                                  const note =
                                    window.prompt(
                                      "Resolution note:",
                                      "Approved for provider refund.",
                                    ) ?? "";
                                  try {
                                    await resolveRefundFn({
                                      data: {
                                        refund_id: r.id,
                                        status: "approved",
                                        admin_note: note || "Approved for provider refund.",
                                      },
                                    });
                                    setAdminData(await getAdmin({ data: {} }));
                                    toast.success("Refund approved");
                                  } catch (e) {
                                    toast.error(
                                      e instanceof Error ? e.message : "Could not update refund",
                                    );
                                  }
                                }}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    const result = await executeRefundFn({
                                      data: { refund_id: r.id },
                                    });
                                    setAdminData(await getAdmin({ data: {} }));
                                    toast.success(
                                      `Provider refund submitted${result.providerRefundId ? `: ${result.providerRefundId}` : ""}`,
                                    );
                                  } catch (e) {
                                    toast.error(
                                      e instanceof Error
                                        ? e.message
                                        : "Provider refund unavailable",
                                    );
                                  }
                                }}
                              >
                                Provider refund
                              </Button>
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="surface overflow-hidden">
                    <div className="border-b border-border/60 p-5">
                      <h3 className="font-medium">Open marketplace reports</h3>
                    </div>
                    <div className="max-h-72 divide-y divide-border/60 overflow-auto">
                      {adminData.reports.filter((r: any) => r.status === "open").length === 0 ? (
                        <div className="p-5 text-sm text-muted-foreground">No open reports.</div>
                      ) : (
                        adminData.reports
                          .filter((r: any) => r.status === "open")
                          .map((r: any) => (
                            <div key={r.id} className="p-4">
                              <div className="text-sm font-medium">{r.reason}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {r.details || "No additional details."}
                              </div>
                              <div className="mt-3 flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async () => {
                                    try {
                                      await resolveReportFn({
                                        data: { report_id: r.id, status: "dismissed" },
                                      });
                                      setAdminData(await getAdmin({ data: {} }));
                                      toast.success("Report dismissed");
                                    } catch (e) {
                                      toast.error(
                                        e instanceof Error ? e.message : "Could not update report",
                                      );
                                    }
                                  }}
                                >
                                  Dismiss
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    try {
                                      await resolveReportFn({
                                        data: { report_id: r.id, status: "resolved" },
                                      });
                                      setAdminData(await getAdmin({ data: {} }));
                                      toast.success("Report resolved");
                                    } catch (e) {
                                      toast.error(
                                        e instanceof Error ? e.message : "Could not update report",
                                      );
                                    }
                                  }}
                                >
                                  Resolve
                                </Button>
                              </div>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                  <div className="surface overflow-hidden">
                    <div className="border-b border-border/60 p-5">
                      <h3 className="font-medium">Payout queue</h3>
                    </div>
                    <div className="max-h-72 divide-y divide-border/60 overflow-auto">
                      {adminData.payouts.filter((p: any) => p.status === "pending").length === 0 ? (
                        <div className="p-5 text-sm text-muted-foreground">No pending payouts.</div>
                      ) : (
                        adminData.payouts
                          .filter((p: any) => p.status === "pending")
                          .map((p: any) => (
                            <div key={p.id} className="p-4">
                              <div className="flex justify-between gap-3 text-sm">
                                <span>{formatMoney(Number(p.amount), p.currency)}</span>
                                <span className="text-muted-foreground">
                                  {p.payout_methods?.method_type || "method"}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {p.payout_methods?.upi_number ||
                                  p.payout_methods?.bank_name ||
                                  "Payout method"}
                              </div>
                              <div className="mt-3 flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async () => {
                                    try {
                                      await resolvePayoutFn({
                                        data: {
                                          payout_id: p.id,
                                          status: "rejected",
                                          admin_note: "Rejected by admin.",
                                        },
                                      });
                                      setAdminData(await getAdmin({ data: {} }));
                                      toast.success("Payout rejected");
                                    } catch (e) {
                                      toast.error(
                                        e instanceof Error ? e.message : "Could not update payout",
                                      );
                                    }
                                  }}
                                >
                                  Reject
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async () => {
                                    try {
                                      const result = await executePayoutFn({
                                        data: { payout_id: p.id },
                                      });
                                      setAdminData(await getAdmin({ data: {} }));
                                      toast.success(
                                        `RazorpayX payout submitted${result.providerId ? `: ${result.providerId}` : ""}`,
                                      );
                                    } catch (e) {
                                      toast.error(
                                        e instanceof Error
                                          ? e.message
                                          : "Automatic payout unavailable; use manual processing",
                                      );
                                    }
                                  }}
                                >
                                  Auto-pay
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    try {
                                      const reference =
                                        window.prompt(
                                          "Enter the payout transfer/reference ID (optional):",
                                          "",
                                        ) ?? "";
                                      await resolvePayoutFn({
                                        data: {
                                          payout_id: p.id,
                                          status: "paid",
                                          provider_reference: reference,
                                          admin_note: "Paid manually by admin.",
                                        },
                                      });
                                      setAdminData(await getAdmin({ data: {} }));
                                      toast.success("Payout marked paid");
                                    } catch (e) {
                                      toast.error(
                                        e instanceof Error ? e.message : "Could not update payout",
                                      );
                                    }
                                  }}
                                >
                                  Mark paid
                                </Button>
                              </div>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="surface overflow-hidden">
                  <div className="border-b border-border/60 p-5">
                    <h3 className="font-medium">Admin audit log</h3>
                  </div>
                  <div className="max-h-64 divide-y divide-border/60 overflow-auto">
                    {(adminData.auditLog ?? []).length === 0 ? (
                      <div className="p-5 text-sm text-muted-foreground">
                        No admin actions recorded yet.
                      </div>
                    ) : (
                      (adminData.auditLog ?? []).map((a: any) => (
                        <div key={a.id} className="p-4 flex justify-between gap-4 text-sm">
                          <div>
                            <div className="font-medium">{a.action.replaceAll("_", " ")}</div>
                            <div className="text-xs text-muted-foreground">
                              {a.target_type}
                              {a.target_id ? ` · ${String(a.target_id).slice(0, 8)}` : ""}
                            </div>
                          </div>
                          <time className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(a.created_at).toLocaleString()}
                          </time>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            )}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
