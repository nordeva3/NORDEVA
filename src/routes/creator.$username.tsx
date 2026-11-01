import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  BadgeCheck,
  Briefcase,
  CalendarDays,
  ExternalLink,
  Github,
  Globe,
  Languages,
  MessageCircle,
  Package,
  Rocket,
  Star,
  Twitter,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { ListingCard } from "@/components/listing-card";
import { Avatar, EmptyState } from "@/components/ui-kit";
import { formatMoney } from "@/lib/currencies";
import {
  PROJECT_STATUSES,
  effectiveStatus,
  packageBadgeLabel,
  type RequestLike,
} from "@/lib/project-requests";
import type { CardListing } from "@/lib/market";
import {
  MessagesUnavailableError,
  fetchBlockState,
  findOrCreateConversation,
} from "@/lib/messages";

const sb = supabase as any;

/** Storefront accents are seller-chosen CSS colours; only trust colour syntax. */
function safeAccent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^(#[0-9a-fA-F]{3,8}|oklch\(|rgb\(|rgba\(|hsl\(|hsla\()/.test(v) ? v : null;
}

const creatorQO = (username: string) =>
  queryOptions({
    queryKey: ["creator", username],
    queryFn: async () => {
      const isUuid = /^[0-9a-f-]{36}$/i.test(username);
      const { data: profile, error } = await sb
        .from("public_profiles")
        .select(
          "id,display_name,username,avatar_url,bio,website_url,twitter_url,github_url,created_at,verified",
        )
        .eq(isUuid ? "id" : "username", username)
        .maybeSingle();
      if (error) throw error;
      if (!profile) throw notFound();

      const [{ data: listings }, { data: follows }, { data: storefront }, listingTotalRes] =
        await Promise.all([
          sb
            .from("listings")
            .select(
              "id,title,description,kind,price,currency,cover_url,category,sales_count,created_at,public_profiles:public_profiles!listings_seller_public_fkey(id,display_name,username,avatar_url)",
            )
            .eq("seller_id", profile.id)
            .eq("status", "active")
            .order("created_at", { ascending: false }),
          sb
            .from("follows")
            .select("id", { count: "exact", head: true })
            .eq("creator_id", profile.id),
          sb
            .from("storefront_settings")
            .select(
              "store_name,tagline,bio,logo_url,banner_url,website_url,social_links,is_public,accent",
            )
            .eq("user_id", profile.id)
            .maybeSingle(),
          sb
            .from("listings")
            .select("id", { count: "exact", head: true })
            .eq("seller_id", profile.id),
        ]);
      // Total listings in any status — one of the developer-signal counts
      // used by the profile-completion variant rule.
      const listingTotal: number | null =
        listingTotalRes && !listingTotalRes.error ? (listingTotalRes.count ?? 0) : null;

      // Professional fields live on public_profiles (Wave B mirror). Fetched
      // separately and failure-isolated: until the database update is
      // applied this returns nothing and the page renders exactly as before.
      let pro: any = null;
      try {
        const { data: proData, error: proError } = await sb
          .from("public_profiles")
          .select(
            "headline,cover_url,skills,languages,experience_level,years_experience,availability,hourly_rate",
          )
          .eq("id", profile.id)
          .maybeSingle();
        if (!proError) pro = proData ?? null;
      } catch {
        pro = null;
      }

      // Services (M1) are fetched in their own failure-isolated query so a
      // database that has the Wave B fields but not services yet still
      // renders the rest of the professional profile.
      try {
        const { data: svcData, error: svcError } = await sb
          .from("public_profiles")
          .select("services")
          .eq("id", profile.id)
          .maybeSingle();
        if (!svcError && svcData) {
          pro = { ...(pro ?? {}), services: svcData.services ?? null };
        }
      } catch {
        /* services not available yet */
      }

      // Portfolio is public by design (profile_portfolio RLS). Also
      // failure-isolated for the same reason.
      let portfolio: any[] = [];
      try {
        const { data: pf, error: pfError } = await sb
          .from("profile_portfolio")
          .select("id,title,description,url,image_url,technologies,sort_order")
          .eq("user_id", profile.id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (!pfError) portfolio = pf ?? [];
      } catch {
        portfolio = [];
      }

      // Completed custom projects where this person was the assigned
      // developer — a plain count over the public requests view, which only
      // exposes non-draft, public-safe columns. Failure-isolated like the
      // rest: null means "unknown", so the stat is omitted rather than faked.
      let projectsCompleted: number | null = null;
      try {
        const { count, error: pcError } = await sb
          .from("website_requests_public")
          .select("id", { count: "exact", head: true })
          .eq("taken_by", profile.id)
          .eq("project_status", "completed");
        if (!pcError) projectsCompleted = count ?? 0;
      } catch {
        projectsCompleted = null;
      }

      // This person's own public project requests (client layout). The view
      // already excludes drafts and private columns; rows are filtered
      // defensively below as well.
      let postedRequests: any[] = [];
      try {
        const { data: reqs, error: reqError } = await sb
          .from("website_requests_public")
          .select(
            "id,title,description,budget,currency,status,taken_by,created_at,tier,package_type,project_status,category,is_draft",
          )
          .eq("requester_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(12);
        if (!reqError) postedRequests = (reqs ?? []).filter((r: any) => r.is_draft !== true);
      } catch {
        postedRequests = [];
      }

      const ids = (listings ?? []).map((l: any) => l.id);
      const ratings: Record<string, { sum: number; n: number }> = {};
      if (ids.length) {
        const { data: revs } = await sb
          .from("reviews")
          .select("listing_id,rating")
          .in("listing_id", ids);
        for (const r of revs ?? []) {
          const cur = ratings[r.listing_id] ?? { sum: 0, n: 0 };
          ratings[r.listing_id] = { sum: cur.sum + r.rating, n: cur.n + 1 };
        }
      }

      const items: CardListing[] = (listings ?? []).map((l: any) => {
        const agg = ratings[l.id];
        return {
          ...l,
          price: Number(l.price),
          sales_count: Number(l.sales_count ?? 0),
          seller: l.public_profiles ?? null,
          rating_avg: agg ? agg.sum / agg.n : null,
          rating_count: agg?.n ?? 0,
        };
      });

      const allRatings = Object.values(ratings);
      const totalReviews = allRatings.reduce((s, r) => s + r.n, 0);
      const ratingAvg = totalReviews
        ? allRatings.reduce((s, r) => s + r.sum, 0) / totalReviews
        : null;

      return {
        profile,
        pro,
        portfolio,
        storefront: storefront ?? null,
        items,
        listingTotal,
        projectsCompleted,
        postedRequests,
        followers: follows?.count ?? 0,
        ratingAvg,
        totalReviews,
      };
    },
  });

export const Route = createFileRoute("/creator/$username")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(creatorQO(params.username)),
  head: ({ loaderData }) => {
    const d = loaderData as any;
    if (!d)
      return { meta: [{ title: "Creator — NORDEVA" }, { name: "robots", content: "noindex" }] };
    const name = d.profile.display_name ?? d.profile.username ?? "Creator";
    const title = `${name} — Creator on NORDEVA`;
    const desc = (d.profile.bio ?? `${name} publishes digital products on NORDEVA.`).slice(0, 155);
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "profile" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  errorComponent: ({ error }) => (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-3xl px-4 py-24 text-center" role="alert">
        <h1 className="text-2xl font-semibold">Couldn't load this creator</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Something went wrong"}
        </p>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Creator not found</h1>
      </div>
    </div>
  ),
  component: CreatorPage,
});

const availabilityMeta: Record<string, { label: string; dot: string; cls: string }> = {
  available: {
    label: "Available for work",
    dot: "bg-emerald-500",
    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  busy: {
    label: "Busy — limited availability",
    dot: "bg-amber-500",
    cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  unavailable: {
    label: "Not available",
    dot: "bg-muted-foreground",
    cls: "bg-muted text-muted-foreground",
  },
};

const experienceLabels: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  expert: "Expert",
  professional: "Professional",
};

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-5 mt-14 text-xl font-semibold sm:text-2xl">{children}</h2>;
}

function CreatorPage() {
  const { username } = Route.useParams();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(creatorQO(username));
  const [userId, setUserId] = useState<string | null>(null);
  const [messaging, setMessaging] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followers, setFollowers] = useState<number>(data.followers);
  const [savedDev, setSavedDev] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: auth }) => {
      const uid = auth.user?.id ?? null;
      setUserId(uid);
      if (!uid) return;
      const { data: f } = await sb
        .from("follows")
        .select("id")
        .eq("follower_id", uid)
        .eq("creator_id", data.profile.id)
        .maybeSingle();
      setFollowing(!!f);
      // Saved-developer state is private to the viewer; ignore failures
      // (e.g. before the database update is applied).
      try {
        const { data: s, error: sError } = await sb
          .from("saved_developers")
          .select("id")
          .eq("user_id", uid)
          .eq("developer_id", data.profile.id)
          .maybeSingle();
        if (!sError) setSavedDev(!!s);
      } catch {
        /* not available yet */
      }
    });
  }, [data.profile.id]);

  const toggleFollow = async () => {
    if (!userId) return toast.error("Sign in to follow creators");
    if (userId === data.profile.id) return toast.error("You cannot follow your own profile");
    if (following) {
      const { error } = await sb
        .from("follows")
        .delete()
        .eq("follower_id", userId)
        .eq("creator_id", data.profile.id);
      if (error) return toast.error("Could not update follow status. Please try again.");
      setFollowing(false);
      setFollowers((n: number) => Math.max(0, n - 1));
    } else {
      const { error } = await sb
        .from("follows")
        .insert({ follower_id: userId, creator_id: data.profile.id });
      if (error) return toast.error(error.message);
      setFollowing(true);
      setFollowers((n: number) => n + 1);
    }
  };

  const toggleSaveDev = async () => {
    if (!userId) return toast.error("Sign in to save developers");
    if (userId === data.profile.id) return;
    if (savedDev) {
      const { error } = await sb
        .from("saved_developers")
        .delete()
        .eq("user_id", userId)
        .eq("developer_id", data.profile.id);
      if (error) return toast.error("Could not update your saved list. Please try again.");
      setSavedDev(false);
      toast.success("Removed from your saved developers");
    } else {
      const { error } = await sb
        .from("saved_developers")
        .insert({ user_id: userId, developer_id: data.profile.id });
      if (error) return toast.error(error.message);
      setSavedDev(true);
      toast.success("Saved to your developer list");
    }
  };

  const startMessage = async () => {
    if (!userId) {
      navigate({ to: "/auth", search: { next: `/creator/${username}` } });
      return;
    }
    if (userId === data.profile.id || messaging) return;
    setMessaging(true);
    try {
      const blocks = await fetchBlockState(userId, data.profile.id);
      if (blocks.blockedMe) {
        toast.error("You can't message this user.");
        return;
      }
      if (blocks.blockedByMe) {
        toast.error(
          "You've blocked this user — unblock them from the conversation to message again.",
        );
        return;
      }
      const conversationId = await findOrCreateConversation(userId, data.profile.id);
      navigate({ to: "/messages/$conversationId", params: { conversationId } });
    } catch (err) {
      toast.error(
        err instanceof MessagesUnavailableError
          ? "Messaging isn't available yet — please check back soon."
          : "Could not start the conversation. Please try again.",
      );
    } finally {
      setMessaging(false);
    }
  };

  const p = data.profile;
  const name = p.display_name ?? p.username ?? "Creator";
  const pro = data.pro as any;
  const isOwnProfile = !!userId && userId === data.profile.id;

  // Developer-vs-client layout uses the same signals as the profile
  // completion variant rule (src/lib/profile-completion.ts): any listing,
  // any portfolio item, or any real skill makes this a developer profile.
  const realSkills: string[] = Array.isArray(pro?.skills)
    ? pro.skills.filter((s: unknown) => typeof s === "string" && s.trim().length > 0)
    : [];
  const realServices: string[] = Array.isArray(pro?.services)
    ? pro.services.filter((s: unknown) => typeof s === "string" && s.trim().length > 0)
    : [];
  const listingSignals = data.listingTotal ?? data.items.length;
  const isDeveloper = listingSignals > 0 || data.portfolio.length > 0 || realSkills.length > 0;

  const accent = safeAccent(data.storefront?.accent);
  const coverImg = data.storefront?.banner_url || pro?.cover_url || null;
  const memberSince = new Date(p.created_at).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
  const bioText = data.storefront?.bio || p.bio;
  const tagline = data.storefront?.tagline;

  const servicesBlock = realServices.length > 0 && (
    <div className={bioText || realSkills.length > 0 ? "mt-6" : ""}>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Services
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {realServices.map((s) => (
          <span
            key={s}
            className="rounded-full border border-lume/30 bg-lume/10 px-3 py-1 text-xs text-lume"
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );

  const socialLinks = (
    <>
      {p.website_url && (
        <a
          href={p.website_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-lume hover:underline"
        >
          <Globe className="size-3.5" /> Website
        </a>
      )}
      {p.twitter_url && (
        <a
          href={p.twitter_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-lume hover:underline"
        >
          <Twitter className="size-3.5" /> X
        </a>
      )}
      {p.github_url && (
        <a
          href={p.github_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-lume hover:underline"
        >
          <Github className="size-3.5" /> GitHub
        </a>
      )}
    </>
  );
  const hasSocial = Boolean(p.website_url || p.twitter_url || p.github_url);

  const stats: { label: string; value: ReactNode }[] = [
    { label: "Products", value: data.items.length },
    { label: "Followers", value: followers },
    {
      label: "Rating",
      value:
        data.ratingAvg != null ? (
          <span className="inline-flex items-center gap-1">
            <Star className="size-4 fill-gold text-gold" />
            {data.ratingAvg.toFixed(1)}
            <span className="text-sm font-normal text-muted-foreground">({data.totalReviews})</span>
          </span>
        ) : (
          "—"
        ),
    },
  ];
  if (data.projectsCompleted != null) {
    stats.push({ label: "Projects completed", value: data.projectsCompleted });
  }

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <div className="mb-5">
          <Link to="/people" className="text-sm text-lume hover:underline">
            ← Find sellers
          </Link>
        </div>

        {/* ---------- Profile header: cover band + overlapping avatar ---------- */}
        <div className="glass-panel overflow-hidden rounded-[1.5rem]">
          <div className="relative h-40 w-full bg-muted sm:h-52">
            {coverImg ? (
              <img src={coverImg} alt="" className="size-full object-cover" />
            ) : (
              <div
                className="size-full lume-gradient opacity-20"
                style={
                  accent
                    ? {
                        backgroundImage: `linear-gradient(115deg, ${accent}59, transparent 55%), linear-gradient(245deg, ${accent}40, transparent 50%)`,
                        opacity: 1,
                      }
                    : undefined
                }
              />
            )}
          </div>

          <div className="px-6 pb-6 sm:px-8 sm:pb-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div
                className="-mt-12 shrink-0 rounded-full sm:-mt-14"
                style={
                  accent
                    ? ({ boxShadow: `0 0 0 4px var(--card), 0 0 0 6px ${accent}` } as CSSProperties)
                    : undefined
                }
              >
                <span className="block rounded-full ring-4 ring-[var(--card)]">
                  <Avatar name={name} url={p.avatar_url} size={96} />
                </span>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pb-1">
                {isDeveloper && !isOwnProfile && (
                  <Link
                    to="/requests"
                    className="glow-btn lume-gradient shrink-0 rounded-2xl px-5 py-2.5 text-sm font-semibold text-white"
                  >
                    Start a project
                  </Link>
                )}
                {isDeveloper && userId && !isOwnProfile && (
                  <button
                    onClick={toggleSaveDev}
                    aria-pressed={savedDev}
                    className={`glow-btn shrink-0 rounded-2xl px-5 py-2.5 text-sm font-semibold ${
                      savedDev
                        ? "border border-lume/50 bg-lume/10 text-lume"
                        : "border border-border/70 bg-card/60 text-foreground"
                    }`}
                  >
                    {savedDev ? "Saved" : "Save developer"}
                  </button>
                )}
                {!isOwnProfile && (
                  <button
                    onClick={startMessage}
                    disabled={messaging}
                    className="glow-btn inline-flex shrink-0 items-center gap-2 rounded-2xl border border-border/70 bg-card/60 px-5 py-2.5 text-sm font-semibold text-foreground disabled:opacity-50"
                  >
                    <MessageCircle className="size-4" />
                    {messaging ? "Opening…" : "Message"}
                  </button>
                )}
                <button
                  onClick={toggleFollow}
                  disabled={isOwnProfile}
                  aria-pressed={following}
                  className={`glow-btn shrink-0 rounded-2xl px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                    following || isDeveloper
                      ? "border border-border/70 bg-card/60 text-foreground"
                      : "lume-gradient text-white"
                  }`}
                >
                  {following ? "Following" : "Follow"}
                </button>
              </div>
            </div>

            <div className="mt-4 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{name}</h1>
                {p.verified && (
                  <span
                    title="Verified seller"
                    aria-label="Verified seller"
                    className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-600 dark:text-sky-400"
                  >
                    <BadgeCheck className="size-3.5" /> Verified seller
                  </span>
                )}
              </div>
              {p.username && (
                <div className="mt-0.5 text-sm text-muted-foreground">@{p.username}</div>
              )}
              {isDeveloper && pro?.headline && (
                <p className="mt-2 font-display text-lg leading-snug text-foreground sm:text-xl">
                  {pro.headline}
                </p>
              )}
              {tagline && (
                <p className="mt-2 max-w-2xl text-sm font-medium text-foreground">{tagline}</p>
              )}

              {/* Key facts */}
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" /> Member since {memberSince}
                </span>
                {isDeveloper && pro?.experience_level && (
                  <span className="inline-flex items-center gap-1.5">
                    <Briefcase className="size-3.5" />
                    {experienceLabels[pro.experience_level] ?? pro.experience_level}
                    {pro.years_experience != null
                      ? ` · ${pro.years_experience} yrs experience`
                      : ""}
                  </span>
                )}
                {isDeveloper && pro?.experience_level == null && pro?.years_experience != null && (
                  <span className="inline-flex items-center gap-1.5">
                    <Briefcase className="size-3.5" /> {pro.years_experience} yrs experience
                  </span>
                )}
                {isDeveloper && pro?.hourly_rate != null && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    ${Number(pro.hourly_rate).toLocaleString()}/hr
                  </span>
                )}
                {isDeveloper && pro?.languages?.length > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Languages className="size-3.5" /> {pro.languages.join(", ")}
                  </span>
                )}
                {!isDeveloper && p.website_url && (
                  <a
                    href={p.website_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-lume hover:underline"
                  >
                    <Globe className="size-3.5" /> Website
                  </a>
                )}
              </div>

              {isDeveloper && pro?.availability && availabilityMeta[pro.availability] && (
                <span
                  className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${availabilityMeta[pro.availability].cls}`}
                >
                  <span
                    className={`size-1.5 rounded-full ${availabilityMeta[pro.availability].dot}`}
                  />
                  {availabilityMeta[pro.availability].label}
                </span>
              )}
            </div>

            {/* Stats strip — real data only (developer layout) */}
            {isDeveloper && (
              <dl className="mt-7 grid grid-cols-2 gap-4 border-t border-border/60 pt-5 sm:grid-cols-4">
                {stats.map((s) => (
                  <div key={s.label}>
                    <dd className="text-xl font-semibold leading-none">{s.value}</dd>
                    <dt className="mt-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                      {s.label}
                    </dt>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>

        {isDeveloper ? (
          <>
            {/* ---------- Portfolio: the visual lead ---------- */}
            {data.portfolio.length > 0 && (
              <>
                <SectionTitle>Portfolio</SectionTitle>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {data.portfolio.map((item: any, idx: number) => {
                    const lead = idx === 0;
                    const card = (
                      <>
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt=""
                            className={`w-full object-cover ${lead ? "h-56 sm:h-72" : "h-40"}`}
                          />
                        ) : (
                          <div
                            className={`grid w-full place-items-center bg-muted text-muted-foreground ${
                              lead ? "h-56 sm:h-72" : "h-40"
                            }`}
                          >
                            <Briefcase className="size-6" />
                          </div>
                        )}
                        <div className="p-4 sm:p-5">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className={`truncate font-medium ${lead ? "text-lg" : ""}`}>
                              {item.title}
                            </h3>
                            {item.url && <ExternalLink className="size-4 shrink-0 text-lume" />}
                          </div>
                          {item.description && (
                            <p
                              className={`mt-1 text-sm text-muted-foreground ${
                                lead ? "line-clamp-3" : "line-clamp-2"
                              }`}
                            >
                              {item.description}
                            </p>
                          )}
                          {item.technologies?.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1">
                              {item.technologies.slice(0, 5).map((t: string) => (
                                <span
                                  key={t}
                                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    );
                    const cls = `block overflow-hidden rounded-2xl border border-border/70 bg-card transition hover:-translate-y-0.5 hover:border-lume/40 ${
                      lead ? "sm:col-span-2 lg:col-span-2" : ""
                    }`;
                    return item.url ? (
                      <a
                        key={item.id}
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className={cls}
                      >
                        {card}
                      </a>
                    ) : (
                      <div key={item.id} className={cls}>
                        {card}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ---------- Products ---------- */}
            <SectionTitle>Published products</SectionTitle>
            {data.items.length === 0 ? (
              <EmptyState
                icon={<Package className="size-5" />}
                title="No published products"
                body="This creator hasn't had a product approved yet."
                action={
                  <Link to="/browse" search={{}} className="text-sm text-lume">
                    Browse the marketplace →
                  </Link>
                }
              />
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {data.items.map((l) => (
                  <ListingCard key={l.id} l={l} />
                ))}
              </div>
            )}

            {/* ---------- About & skills ---------- */}
            {(bioText || realSkills.length > 0 || realServices.length > 0 || hasSocial) && (
              <>
                <SectionTitle>About</SectionTitle>
                <div className="glass-panel rounded-[1.5rem] p-6 sm:p-8">
                  {bioText && (
                    <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                      {bioText}
                    </p>
                  )}
                  {realSkills.length > 0 && (
                    <div className={bioText ? "mt-6" : ""}>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Skills
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {realSkills.map((s) => (
                          <span
                            key={s}
                            className="rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {servicesBlock}
                  {hasSocial && (
                    <div className="mt-6 flex flex-wrap gap-4 text-xs">{socialLinks}</div>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {/* ---------- Client layout: about + posted projects ---------- */}
            {(bioText || realServices.length > 0 || hasSocial) && (
              <>
                <SectionTitle>About</SectionTitle>
                <div className="glass-panel rounded-[1.5rem] p-6 sm:p-8">
                  {bioText && (
                    <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                      {bioText}
                    </p>
                  )}
                  {servicesBlock}
                  {hasSocial && (
                    <div
                      className={`${bioText || realServices.length > 0 ? "mt-6" : ""} flex flex-wrap gap-4 text-xs`}
                    >
                      {socialLinks}
                    </div>
                  )}
                </div>
              </>
            )}

            {data.postedRequests.length > 0 && (
              <>
                <SectionTitle>Projects posted</SectionTitle>
                <div className="grid gap-4 sm:grid-cols-2">
                  {data.postedRequests.map((r: any) => {
                    const like: RequestLike = {
                      id: r.id ?? "",
                      requester_id: p.id,
                      title: r.title ?? "",
                      description: r.description ?? "",
                      budget: r.budget ?? 0,
                      currency: r.currency ?? "USD",
                      status: r.status ?? "open",
                      taken_by: r.taken_by ?? null,
                      created_at: r.created_at ?? "",
                      tier: r.tier,
                      package_type: r.package_type,
                      project_status: r.project_status,
                      category: r.category,
                    };
                    const status = effectiveStatus(like);
                    const statusMeta = PROJECT_STATUSES[status];
                    const pkgLabel = packageBadgeLabel(like);
                    return (
                      <article
                        key={r.id}
                        className="rounded-2xl border border-border/70 bg-card p-5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="min-w-0 font-medium leading-snug">{r.title}</h3>
                          {statusMeta && (
                            <span
                              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium ${statusMeta.classes}`}
                            >
                              {statusMeta.label}
                            </span>
                          )}
                        </div>
                        {r.description && (
                          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                            {r.description}
                          </p>
                        )}
                        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {formatMoney(Number(r.budget ?? 0), r.currency ?? "USD")}
                          </span>
                          {pkgLabel && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                              {pkgLabel}
                            </span>
                          )}
                          {r.category && <span>{r.category}</span>}
                          <span className="inline-flex items-center gap-1">
                            <Rocket className="size-3" /> Posted{" "}
                            {new Date(r.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}

            {data.postedRequests.length === 0 && !bioText && (
              <div className="mt-12">
                <EmptyState
                  icon={<Users className="size-5" />}
                  title="Nothing public yet"
                  body="This member hasn't posted any public projects or details yet."
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
