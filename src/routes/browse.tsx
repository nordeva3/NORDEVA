import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LayoutList,
  Package,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { ListingCard } from "@/components/listing-card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CardSkeletonGrid, EmptyState } from "@/components/ui-kit";
import {
  fetchBrowse,
  fetchSearchSuggestions,
  recordSearchQuery,
  type BrowseParams,
  type SearchSuggestion,
} from "@/lib/market";

const searchSchema = z.object({
  q: z.string().optional(),
  kind: z.enum(["software", "website"]).optional(),
  category: z.string().optional(),
  sort: z.enum(["new", "trending", "price_asc", "price_desc", "rating"]).optional(),
  page: z.number().int().min(1).optional(),
});

type S = z.infer<typeof searchSchema>;

const PER_PAGE = 12;

const browseQO = (params: BrowseParams) =>
  queryOptions({
    queryKey: ["browse", params],
    queryFn: () => fetchBrowse({ ...params, perPage: PER_PAGE }),
  });

export const Route = createFileRoute("/browse")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    context.queryClient.ensureQueryData(browseQO(deps));
  },
  head: ({ match }) => {
    const s = match.search as S;
    const kindLabel =
      s.kind === "software" ? "Software" : s.kind === "website" ? "Websites" : "Digital products";
    const title = s.q
      ? `"${s.q}" — NORDEVA marketplace`
      : `${kindLabel} for sale — NORDEVA marketplace`;
    const desc = `Browse ${kindLabel.toLowerCase()} from independent creators on NORDEVA. Instant delivery, real reviews, 15% flat fee.`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  errorComponent: ({ error }) => (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-3xl px-4 py-24 text-center" role="alert">
        <h1 className="text-2xl font-semibold">Couldn't load the marketplace</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Something went wrong"}
        </p>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">No products found.</div>
    </div>
  ),
  component: Browse,
});

const SORTS = [
  { val: undefined, label: "Newest" },
  { val: "trending" as const, label: "Trending" },
  { val: "rating" as const, label: "Top rated" },
  { val: "price_asc" as const, label: "Price ↑" },
  { val: "price_desc" as const, label: "Price ↓" },
];

function Browse() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { q, kind, category, sort, page = 1 } = search;
  const { data, isFetching } = useQuery(browseQO({ q, kind, category, sort, page }));
  const [term, setTerm] = useState(q ?? "");
  const [categories, setCategories] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setViewState] = useState<"grid" | "list">("grid");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);

  useEffect(() => setTerm(q ?? ""), [q]);

  // Restore the saved grid/list preference after mount (grid is the SSR default).
  useEffect(() => {
    try {
      if (window.localStorage.getItem("velora-browse-view") === "list") setViewState("list");
    } catch {
      /* storage unavailable — grid stays */
    }
  }, []);

  const setView = (v: "grid" | "list") => {
    setViewState(v);
    try {
      window.localStorage.setItem("velora-browse-view", v);
    } catch {
      /* the view preference is best-effort */
    }
  };

  useEffect(() => {
    if (term.trim().length < 2) {
      setSuggestions([]);
      setActiveSuggestion(-1);
      return;
    }
    const timer = setTimeout(async () => {
      const next = await fetchSearchSuggestions(term, 10);
      setSuggestions(next);
      setActiveSuggestion(-1);
    }, 180);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    void (async () => {
      // Prefer the admin-managed categories table (active rows, admin order).
      try {
        const { data, error } = await supabase
          .from("categories")
          .select("name")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true });
        if (!error && data && data.length > 0) {
          setCategories(data.map((c) => c.name));
          return;
        }
      } catch {
        /* fall through to the listings-derived fallback */
      }
      // Fallback (e.g. before the categories migration is applied): derive
      // category names from live listings, as this page originally did.
      const { data } = await (supabase as any)
        .from("listings")
        .select("category")
        .eq("status", "active");
      const names = new Set<string>();
      for (const r of data ?? []) if (r.category) names.add(r.category);
      setCategories([...names].sort());
    })();
  }, []);

  const set = (patch: Partial<S>) =>
    navigate({ search: (prev: S) => ({ ...prev, page: undefined, ...patch }) });

  const clearAll = () =>
    navigate({
      search: {
        q: undefined,
        kind: undefined,
        category: undefined,
        sort: undefined,
        page: undefined,
      },
    });

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const hasFilters = Boolean(q || kind || category || sort);
  const activeFilterCount = [kind, category, sort].filter(Boolean).length;

  const viewBtn = (active: boolean) =>
    `grid size-7 place-items-center rounded-full transition-colors ${
      active ? "lume-gradient text-white" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:py-14">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold sm:text-4xl">Marketplace</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {total} {total === 1 ? "product" : "products"}
              {q ? ` matching "${q}"` : ""}
            </p>
          </div>
          <button
            onClick={() => setFiltersOpen(true)}
            className="glow-btn inline-flex shrink-0 items-center gap-2 rounded-2xl border border-border/70 bg-card/60 px-4 py-2.5 text-xs lg:hidden"
            aria-haspopup="dialog"
          >
            <SlidersHorizontal className="size-3.5" /> Filters
            {activeFilterCount > 0 && (
              <span className="grid size-[18px] place-items-center rounded-full lume-gradient text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        <div className="relative mt-7">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const query = term.trim();
              if (!query) {
                set({ q: undefined });
                return;
              }
              void recordSearchQuery(query);
              set({ q: query });
              setSearchOpen(false);
              setActiveSuggestion(-1);
            }}
          >
            <input
              value={term}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searchOpen && suggestions.length > 0}
              aria-controls="lume-browse-search-suggestions"
              aria-activedescendant={
                activeSuggestion >= 0 ? `lume-browse-search-option-${activeSuggestion}` : undefined
              }
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => {
                setTerm(e.target.value);
                setSearchOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && suggestions.length) {
                  e.preventDefault();
                  setSearchOpen(true);
                  setActiveSuggestion((i) => (i + 1) % suggestions.length);
                } else if (e.key === "ArrowUp" && suggestions.length) {
                  e.preventDefault();
                  setActiveSuggestion((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
                } else if (e.key === "Escape") {
                  setSearchOpen(false);
                  setActiveSuggestion(-1);
                } else if (e.key === "Enter" && activeSuggestion >= 0) {
                  e.preventDefault();
                  const selected = suggestions[activeSuggestion];
                  setTerm(selected.label);
                  if (selected.suggestion_type === "product" && selected.listing_id) {
                    navigate({ to: "/listing/$id", params: { id: selected.listing_id } });
                  } else {
                    void recordSearchQuery(selected.label);
                    set({ q: selected.label });
                  }
                  setSearchOpen(false);
                  setActiveSuggestion(-1);
                }
              }}
              placeholder="Search products, tools, templates…"
              className="h-12 w-full rounded-2xl border border-border/60 bg-card/60 px-5 text-sm placeholder:text-muted-foreground/60 focus:border-lume/60 focus:outline-none"
            />
          </form>
          {searchOpen && suggestions.length > 0 && (
            <div
              id="lume-browse-search-suggestions"
              role="listbox"
              className="absolute left-0 right-0 top-14 z-40 overflow-hidden rounded-2xl border border-border/70 bg-popover/95 p-1.5 shadow-2xl backdrop-blur-xl"
            >
              {suggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.suggestion_type}-${suggestion.label}-${suggestion.listing_id ?? ""}`}
                  id={`lume-browse-search-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeSuggestion === index}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setTerm(suggestion.label);
                    if (suggestion.suggestion_type === "product" && suggestion.listing_id)
                      navigate({ to: "/listing/$id", params: { id: suggestion.listing_id } });
                    else {
                      void recordSearchQuery(suggestion.label);
                      set({ q: suggestion.label });
                    }
                    setSearchOpen(false);
                    setActiveSuggestion(-1);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${activeSuggestion === index ? "bg-accent/60" : "hover:bg-accent/50"}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                      {suggestion.suggestion_type}
                    </span>
                    <span className="truncate">{suggestion.label}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {hasFilters && (
          <div className="mt-5 flex flex-wrap items-center gap-2" aria-label="Active filters">
            <span className="mr-1 text-[11px] uppercase tracking-widest text-muted-foreground">
              Active filters
            </span>
            {q && <FilterChip label={`Search: “${q}”`} onRemove={() => set({ q: undefined })} />}
            {kind && (
              <FilterChip
                label={kind === "software" ? "Software & code" : "Websites & themes"}
                onRemove={() => set({ kind: undefined })}
              />
            )}
            {category && (
              <FilterChip label={category} onRemove={() => set({ category: undefined })} />
            )}
            {sort && (
              <FilterChip
                label={`Sort: ${SORTS.find((s) => s.val === sort)?.label ?? sort}`}
                onRemove={() => set({ sort: undefined })}
              />
            )}
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3" /> Clear all
            </button>
          </div>
        )}

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent side="left" className="w-[85vw] max-w-xs overflow-y-auto p-5">
            <SheetHeader className="text-left">
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription className="sr-only">
                Filter marketplace products by type, category and sort order.
              </SheetDescription>
            </SheetHeader>
            {hasFilters && (
              <button
                onClick={clearAll}
                className="mt-3 text-xs font-medium text-lume hover:underline"
              >
                Clear all filters
              </button>
            )}
            <FilterSections
              categories={categories}
              kind={kind}
              category={category}
              sort={sort}
              set={set}
            />
            <button
              onClick={() => setFiltersOpen(false)}
              className="glow-btn mt-6 w-full rounded-2xl lume-gradient px-5 py-3 text-sm font-semibold text-white"
            >
              Show {total} {total === 1 ? "product" : "products"}
            </button>
          </SheetContent>
        </Sheet>

        <div className="mt-8 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start lg:gap-8">
          <aside
            className="surface sticky top-24 hidden max-h-[calc(100vh-7rem)] overflow-y-auto p-5 lg:block"
            aria-label="Marketplace filters"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Filters</h2>
              {hasFilters && (
                <button
                  onClick={clearAll}
                  className="text-xs font-medium text-lume hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
            <FilterSections
              categories={categories}
              kind={kind}
              category={category}
              sort={sort}
              set={set}
            />
          </aside>

          <section className="min-w-0" aria-label="Marketplace products">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{total}</span>{" "}
                {total === 1 ? "product" : "products"}
                {q ? (
                  <>
                    {" "}
                    for <span className="font-semibold text-foreground">“{q}”</span>
                  </>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
                  <span>Trusted digital goods</span>
                  <span className="size-1.5 rounded-full bg-lume" />
                  <span>Creator-led</span>
                </div>
                <div
                  className="flex items-center gap-1 rounded-full border border-border/60 bg-card/50 p-1"
                  role="group"
                  aria-label="Change product view"
                >
                  <button
                    type="button"
                    onClick={() => setView("grid")}
                    aria-pressed={view === "grid"}
                    aria-label="Grid view"
                    className={viewBtn(view === "grid")}
                  >
                    <LayoutGrid className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("list")}
                    aria-pressed={view === "list"}
                    aria-label="List view"
                    className={viewBtn(view === "list")}
                  >
                    <LayoutList className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
            {!data && isFetching ? (
              <CardSkeletonGrid count={8} />
            ) : data && data.items.length === 0 ? (
              <EmptyState
                icon={<Package className="size-5" />}
                title="No products match your filters"
                body="Try a different search term or clear the filters. NORDEVA only shows real, approved listings — never placeholders."
                action={
                  <Link
                    to="/sell"
                    className="glow-btn inline-flex items-center gap-2 rounded-2xl lume-gradient px-5 py-2.5 text-sm font-semibold text-white"
                  >
                    List your product
                  </Link>
                }
              />
            ) : view === "list" ? (
              <div
                className={`flex flex-col gap-4 transition-opacity duration-200 ${isFetching ? "opacity-60" : ""}`}
              >
                {data?.items.map((l) => (
                  <ListingCard key={l.id} l={l} variant="horizontal" />
                ))}
              </div>
            ) : (
              <div
                className={`grid gap-4 transition-opacity duration-200 sm:grid-cols-2 xl:grid-cols-3 ${isFetching ? "opacity-60" : ""}`}
              >
                {data?.items.map((l) => (
                  <ListingCard key={l.id} l={l} />
                ))}
              </div>
            )}
            {pages > 1 && (
              <div className="mt-12 flex items-center justify-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => navigate({ search: (p: S) => ({ ...p, page: page - 1 }) })}
                  className="grid size-10 place-items-center rounded-full border border-border/60 bg-card/50 disabled:opacity-35"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </button>
                {Array.from({ length: pages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => navigate({ search: (p: S) => ({ ...p, page: i + 1 }) })}
                    className={`size-10 rounded-full text-xs transition-colors ${
                      page === i + 1
                        ? "lume-gradient font-semibold text-white"
                        : "border border-border/60 bg-card/50 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  disabled={page >= pages}
                  onClick={() => navigate({ search: (p: S) => ({ ...p, page: page + 1 }) })}
                  className="grid size-10 place-items-center rounded-full border border-border/60 bg-card/50 disabled:opacity-35"
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-lume/40 bg-lume/10 py-1.5 pl-3 pr-1.5 text-xs">
      <span className="max-w-48 truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        className="grid size-[18px] place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/**
 * The three filter groups (product type, categories, sort), shared verbatim
 * by the desktop sidebar and the mobile filter drawer so both surfaces drive
 * the exact same route search params.
 */
function FilterSections({
  categories,
  kind,
  category,
  sort,
  set,
}: {
  categories: string[];
  kind: S["kind"];
  category?: string;
  sort: S["sort"];
  set: (patch: Partial<S>) => void;
}) {
  return (
    <>
      <div className="mt-5 border-t border-border/70 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Product type
        </h3>
        <div className="mt-3 grid gap-1.5">
          {[
            { value: undefined, label: "All products" },
            { value: "software" as const, label: "Software & code" },
            { value: "website" as const, label: "Websites & themes" },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => set({ kind: item.value })}
              aria-pressed={kind === item.value}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${kind === item.value ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <span>{item.label}</span>
              {kind === item.value && <span className="size-1.5 rounded-full bg-lume" />}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5 border-t border-border/70 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Categories
        </h3>
        <div className="mt-3 grid gap-1.5">
          <button
            onClick={() => set({ category: undefined })}
            aria-pressed={!category}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${!category ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            <span>All categories</span>
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => set({ category: c })}
              aria-pressed={category?.toLowerCase() === c.toLowerCase()}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${category?.toLowerCase() === c.toLowerCase() ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <span className="truncate">{c}</span>
              {category?.toLowerCase() === c.toLowerCase() && (
                <span className="size-1.5 shrink-0 rounded-full bg-lume" />
              )}
            </button>
          ))}
          {categories.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Categories appear as products are published.
            </p>
          )}
        </div>
      </div>
      <div className="mt-5 border-t border-border/70 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sort by
        </h3>
        <div className="mt-3 grid gap-1.5">
          {SORTS.map((item) => (
            <button
              key={item.label}
              onClick={() => set({ sort: item.val })}
              aria-pressed={sort === item.val}
              className={`rounded-lg px-3 py-2 text-left text-sm ${sort === item.val ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
