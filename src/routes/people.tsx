import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Search, Users, ArrowUpRight, Store, LoaderCircle, X } from "lucide-react";
import { TopNav } from "@/components/top-nav";
import { Avatar } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;
type MarketplaceProfile = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  verified: boolean;
};

/** Professional fields mirrored onto public_profiles (Wave B + M1). */
type ProFields = {
  headline: string | null;
  skills: string[] | null;
  availability: string | null;
  services: string[] | null;
};

const availabilityDot: Record<string, { dot: string; label: string }> = {
  available: { dot: "bg-emerald-500", label: "Available" },
  busy: { dot: "bg-amber-500", label: "Busy" },
  unavailable: { dot: "bg-muted-foreground", label: "Unavailable" },
};

/** Filter values are the real `availability` column values (profile editor). */
const AVAILABILITY_FILTERS = [
  { value: "any", label: "Any availability" },
  { value: "available", label: "Available now" },
  { value: "busy", label: "Limited availability" },
  { value: "unavailable", label: "Unavailable" },
] as const;

const PAGE_SIZE = 24;
/**
 * When a search term or any filter is active, matching must also consider
 * headline/skills/services, which PostgREST cannot substring-match inside
 * text[] columns. So the filtered path loads a bounded candidate set
 * (verified first, then name) and matches in memory. The default path
 * stays server-paginated via "Load more".
 */
const CANDIDATE_CAP = 200;

function cleanTerm(raw: string) {
  return raw
    .trim()
    .replace(/[^\p{L}\p{N}_ .@-]/gu, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .replace(/^@/, "")
    .trim();
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  return out.length ? out : null;
}

export const Route = createFileRoute("/people")({
  head: () => ({
    meta: [
      { title: "Find sellers and creators — NORDEVA" },
      {
        name: "description",
        content:
          "Discover NORDEVA marketplace sellers and creators by name, username, skill or service.",
      },
    ],
  }),
  component: PeoplePage,
});

function PeoplePage() {
  const [term, setTerm] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<string>("any");
  const [sellsProducts, setSellsProducts] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [profiles, setProfiles] = useState<MarketplaceProfile[]>([]);
  const [proById, setProById] = useState<Record<string, ProFields>>({});
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedOnceRef = useRef(false);

  const cleaned = cleanTerm(term);
  const filtersActive = cleaned.length > 0 || availabilityFilter !== "any" || sellsProducts;

  const clearFilters = () => {
    setTerm("");
    setAvailabilityFilter("any");
    setSellsProducts(false);
    setVisibleCount(PAGE_SIZE);
  };

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(
      async () => {
        if (loadedOnceRef.current) setLoadingMore(true);
        else setLoading(true);
        setError(null);
        try {
          const baseSelect = "id,display_name,username,avatar_url,bio,verified";
          let rows: MarketplaceProfile[] = [];
          if (!filtersActive) {
            // Default path: server-paginated, grows via "Load more".
            const { data, error: queryError } = await sb
              .from("public_profiles")
              .select(baseSelect)
              .order("verified", { ascending: false })
              .order("display_name", { ascending: true })
              .limit(visibleCount);
            if (queryError) throw queryError;
            if (!active) return;
            rows = (data ?? []) as MarketplaceProfile[];
            setHasMore(rows.length === visibleCount);
          } else {
            // Filtered path: bounded candidate set, matched in memory below.
            const { data, error: queryError } = await sb
              .from("public_profiles")
              .select(baseSelect)
              .order("verified", { ascending: false })
              .order("display_name", { ascending: true })
              .limit(CANDIDATE_CAP);
            if (queryError) throw queryError;
            if (!active) return;
            rows = (data ?? []) as MarketplaceProfile[];
            setHasMore(false);
          }
          if (!active) return;

          // Professional fields are fetched separately and failure-isolated
          // (same pattern as the public profile page): until the database
          // update is applied this simply leaves the cards as they were.
          const map: Record<string, ProFields> = {};
          if (rows.length) {
            const ids = rows.map((r) => r.id);
            try {
              const { data: proData, error: proError } = await sb
                .from("public_profiles")
                .select("id,headline,skills,availability")
                .in("id", ids);
              if (!proError && proData) {
                for (const row of proData as any[]) {
                  map[row.id] = {
                    headline: row.headline ?? null,
                    skills: stringList(row.skills),
                    availability: row.availability ?? null,
                    services: null,
                  };
                }
              }
            } catch {
              /* professional fields not available yet */
            }
            // services lives in its own failure-isolated query so a database
            // that has not received the services column yet still returns
            // headline/skills/availability above.
            try {
              const { data: svcData, error: svcError } = await sb
                .from("public_profiles")
                .select("id,services")
                .in("id", ids);
              if (!svcError && svcData) {
                for (const row of svcData as any[]) {
                  const entry =
                    map[row.id] ??
                    (map[row.id] = {
                      headline: null,
                      skills: null,
                      availability: null,
                      services: null,
                    });
                  entry.services = stringList(row.services);
                }
              }
            } catch {
              /* services not available yet */
            }
          }
          if (!active) return;
          setProById(map);

          let display = rows;
          if (filtersActive) {
            // "Sells products": resolve which candidates have at least one
            // active listing. Failure-isolated — if the query fails, the
            // toggle simply matches nobody rather than breaking the page.
            let sellerSet: Set<string> | null = null;
            if (sellsProducts && rows.length) {
              sellerSet = new Set<string>();
              try {
                const { data: listingRows, error: listingError } = await sb
                  .from("listings")
                  .select("seller_id")
                  .eq("status", "active")
                  .in(
                    "seller_id",
                    rows.map((r) => r.id),
                  );
                if (!listingError && listingRows) {
                  for (const row of listingRows as any[]) sellerSet.add(row.seller_id);
                }
              } catch {
                /* listings unavailable — toggle matches nobody */
              }
            }
            const q = cleaned.toLowerCase();
            display = rows.filter((p) => {
              const pro = map[p.id];
              if (availabilityFilter !== "any" && pro?.availability !== availabilityFilter) {
                return false;
              }
              if (sellsProducts && !(sellerSet?.has(p.id) ?? false)) return false;
              if (q) {
                const text = [p.display_name, p.username, pro?.headline]
                  .filter(Boolean)
                  .join(" ")
                  .toLowerCase();
                if (text.includes(q)) return true;
                const tags = [...(pro?.skills ?? []), ...(pro?.services ?? [])];
                return tags.some((t) => t.toLowerCase().includes(q));
              }
              return true;
            });
          }
          if (!active) return;
          setProfiles(display);
        } catch (e) {
          if (active) {
            setProfiles([]);
            setError(e instanceof Error ? e.message : "Could not load marketplace profiles.");
          }
        } finally {
          if (active) {
            loadedOnceRef.current = true;
            setLoading(false);
            setLoadingMore(false);
          }
        }
      },
      term.trim() ? 220 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, availabilityFilter, sellsProducts, visibleCount]);

  const chipClass =
    "inline-flex items-center gap-1.5 rounded-full border border-lume/40 bg-lume/10 px-3 py-1.5 text-xs font-medium text-lume";
  const chipButtonClass = "grid size-4 place-items-center rounded-full hover:bg-lume/20";

  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <section className="people-hero glass-panel overflow-hidden rounded-[1.75rem] p-6 sm:p-10">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-lume">
            <Users className="size-4" /> NORDEVA community
          </div>
          <div className="mt-4 grid gap-6 md:grid-cols-[1fr_0.8fr] md:items-end">
            <div>
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">
                Good work starts with the right people.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Meet independent creators, browse thoughtful storefronts, and find products made by
                people worth following.
              </p>
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                type="search"
                autoComplete="off"
                placeholder="Search name, skill or service…"
                aria-label="Search creators by name, username, skill or service"
                className="h-14 w-full rounded-2xl border border-border/70 bg-background/70 pl-12 pr-4 text-sm outline-none transition focus:border-lume/70 focus:ring-2 focus:ring-lume/15"
              />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/50 px-3 py-1.5">
              <Users className="size-3.5" /> Public marketplace profiles
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/50 px-3 py-1.5">
              <BadgeCheck className="size-3.5 text-sky-500" /> Verified sellers highlighted
            </span>
            <span>
              {loading || loadingMore
                ? "Searching…"
                : `${profiles.length} ${profiles.length === 1 ? "profile" : "profiles"} shown`}
            </span>
          </div>
        </section>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Select value={availabilityFilter} onValueChange={(v) => setAvailabilityFilter(v)}>
            <SelectTrigger className="w-[210px]" aria-label="Filter by availability">
              <SelectValue placeholder="Any availability" />
            </SelectTrigger>
            <SelectContent>
              {AVAILABILITY_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            aria-pressed={sellsProducts}
            onClick={() => setSellsProducts((v) => !v)}
            className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm transition ${
              sellsProducts
                ? "border-lume/50 bg-lume/10 font-medium text-lume"
                : "border-border/70 bg-background/50 text-muted-foreground hover:border-lume/40 hover:text-foreground"
            }`}
          >
            <Store className="size-4" /> Sells products
          </button>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm font-medium text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
            >
              Clear all
            </button>
          )}
        </div>

        {filtersActive && (
          <div className="mt-3 flex flex-wrap gap-2">
            {cleaned && (
              <span className={chipClass}>
                Search “{cleaned}”
                <button
                  type="button"
                  aria-label="Clear search"
                  className={chipButtonClass}
                  onClick={() => setTerm("")}
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            {availabilityFilter !== "any" && (
              <span className={chipClass}>
                {AVAILABILITY_FILTERS.find((f) => f.value === availabilityFilter)?.label ??
                  availabilityFilter}
                <button
                  type="button"
                  aria-label="Clear availability filter"
                  className={chipButtonClass}
                  onClick={() => setAvailabilityFilter("any")}
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            {sellsProducts && (
              <span className={chipClass}>
                Sells products
                <button
                  type="button"
                  aria-label="Clear sells products filter"
                  className={chipButtonClass}
                  onClick={() => setSellsProducts(false)}
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
          </div>
        )}

        <section className="mt-8" aria-live="polite">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">
                {filtersActive ? "Search results" : "Discover sellers"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {filtersActive
                  ? `${profiles.length} ${profiles.length === 1 ? "creator matches" : "creators match"} your search and filters.`
                  : "Open a profile to view its storefront and published listings."}
              </p>
            </div>
          </div>
          {error ? (
            <div
              role="alert"
              className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm"
            >
              <p className="font-medium">Profiles could not be loaded.</p>
              <p className="mt-1 text-muted-foreground">{error}</p>
              <p className="mt-2 text-muted-foreground">
                Check that Supabase is configured and apply the NORDEVA profile-search migration.
              </p>
            </div>
          ) : loading ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Loading profiles…
            </div>
          ) : profiles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center">
              <Users className="mx-auto size-8 text-muted-foreground" />
              <h3 className="mt-3 font-semibold">No profiles found</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {filtersActive
                  ? "No creators match your search and filters. Try a different term, or clear the filters to browse everyone."
                  : "Try a different name or username."}
              </p>
              {filtersActive && (
                <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {profiles.map((profile) => {
                  const name = profile.display_name || profile.username || "NORDEVA seller";
                  const pro = proById[profile.id];
                  const topSkills = (pro?.skills ?? []).slice(0, 3);
                  const services = pro?.services ?? [];
                  const availability = pro?.availability
                    ? availabilityDot[pro.availability]
                    : undefined;
                  return (
                    <article
                      key={profile.id}
                      className="people-profile-card group flex flex-col rounded-2xl border border-border/70 bg-card p-5 transition duration-200 hover:-translate-y-0.5 hover:border-lume/40 hover:shadow-lg hover:shadow-black/5"
                    >
                      <div className="flex items-start gap-3">
                        <Avatar name={name} url={profile.avatar_url} size={56} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <h3 className="truncate font-semibold">{name}</h3>
                            {profile.verified && (
                              <span title="Verified seller" aria-label="Verified seller">
                                <BadgeCheck className="size-4 shrink-0 fill-sky-500/15 text-sky-500" />
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {profile.username ? `@${profile.username}` : "NORDEVA member"}
                          </p>
                          {pro?.headline && (
                            <p className="mt-1 line-clamp-1 text-sm font-medium leading-snug">
                              {pro.headline}
                            </p>
                          )}
                          {profile.verified && (
                            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-600 dark:text-sky-400">
                              <BadgeCheck className="size-3" /> Verified seller
                            </span>
                          )}
                        </div>
                        {availability && (
                          <span
                            className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"
                            title={availability.label}
                          >
                            <span className={`size-2 rounded-full ${availability.dot}`} />
                            {availability.label}
                          </span>
                        )}
                      </div>
                      <p className="mt-4 min-h-10 line-clamp-2 text-sm leading-5 text-muted-foreground">
                        {profile.bio ||
                          "Explore this seller’s storefront and published marketplace listings."}
                      </p>
                      {topSkills.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {topSkills.map((s) => (
                            <span
                              key={s}
                              className="rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-[11px] text-muted-foreground"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                      {services.length > 0 && (
                        <p className="mt-3 truncate text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/80">Offers:</span>{" "}
                          {services[0]}
                          {services.length > 1 ? ` · +${services.length - 1} more` : ""}
                        </p>
                      )}
                      <div className="flex-1" />
                      <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4">
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Store className="size-3.5" /> Independent seller
                        </span>
                        <Link
                          to="/creator/$username"
                          params={{ username: profile.username || profile.id }}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-lume transition group-hover:gap-2"
                        >
                          View profile <ArrowUpRight className="size-4" />
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
              {!filtersActive && hasMore && (
                <div className="mt-8 text-center">
                  <Button
                    variant="outline"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <>
                        <LoaderCircle className="mr-2 size-4 animate-spin" /> Loading…
                      </>
                    ) : (
                      "Load more creators"
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
