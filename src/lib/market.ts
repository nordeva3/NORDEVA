import { supabase } from "@/integrations/supabase/client";
import { PRODUCT_CATEGORIES } from "./product-studio";

// Generated DB types lag behind the newest tables/columns; use a loose client here.
const sb = supabase as any;

export type CardListing = {
  id: string;
  title: string;
  description: string | null;
  kind: "software" | "website";
  price: number;
  currency: string;
  cover_url: string | null;
  category: string | null;
  sales_count: number;
  created_at: string;
  seller: {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  } | null;
  rating_avg: number | null;
  rating_count: number;
};

const SELECT =
  "id,title,description,kind,price,currency,cover_url,category,sales_count,created_at,seller_id,public_profiles:public_profiles!listings_seller_public_fkey(id,display_name,username,avatar_url)";

async function attachRatings(rows: any[]): Promise<CardListing[]> {
  const ids = rows.map((r) => r.id);
  const ratings = new Map<string, { sum: number; n: number }>();
  if (ids.length) {
    const { data } = await sb.from("reviews").select("listing_id,rating").in("listing_id", ids);
    for (const r of data ?? []) {
      const cur = ratings.get(r.listing_id) ?? { sum: 0, n: 0 };
      cur.sum += r.rating;
      cur.n += 1;
      ratings.set(r.listing_id, cur);
    }
  }
  return rows.map((r) => {
    const agg = ratings.get(r.id);
    return {
      ...r,
      price: Number(r.price),
      sales_count: Number(r.sales_count ?? 0),
      seller: r.public_profiles ?? null,
      rating_avg: agg ? agg.sum / agg.n : null,
      rating_count: agg?.n ?? 0,
    } as CardListing;
  });
}

export type SearchSuggestion = {
  suggestion_type: "query" | "product" | "category" | "tag";
  label: string;
  listing_id: string | null;
  category: string | null;
  price: number | null;
  currency: string | null;
  popularity: number;
};

export async function fetchSearchSuggestions(
  query: string,
  limit = 10,
): Promise<SearchSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await sb.rpc("search_suggestions", { p_query: q, p_limit: limit });
  if (error) {
    // Keep autocomplete non-blocking if an older database has not received the migration yet.
    const { data: fallback } = await sb
      .from("listings")
      .select("id,title,price,currency,kind,category")
      .eq("status", "active")
      .ilike("title", `%${q}%`)
      .limit(limit);
    return (fallback ?? []).map((row: any) => ({
      suggestion_type: "product",
      label: row.title,
      listing_id: row.id,
      category: row.category ?? null,
      price: Number(row.price),
      currency: row.currency,
      popularity: 0,
    }));
  }
  return (data ?? []).map((row: any) => ({
    suggestion_type: row.suggestion_type,
    label: row.label,
    listing_id: row.listing_id ?? null,
    category: row.category ?? null,
    price: row.price == null ? null : Number(row.price),
    currency: row.currency ?? null,
    popularity: Number(row.popularity ?? 0),
  }));
}

export async function recordSearchQuery(query: string) {
  const q = query.trim();
  if (q.length < 2) return;
  await sb.rpc("record_search_query", { p_query: q });
}

export type BrowseParams = {
  q?: string;
  kind?: "software" | "website";
  category?: string;
  sort?: "new" | "trending" | "price_asc" | "price_desc" | "rating";
  page?: number;
  perPage?: number;
};

export async function fetchBrowse(params: BrowseParams) {
  const perPage = params.perPage ?? 12;
  const page = params.page ?? 1;
  let query = sb.from("listings").select(SELECT, { count: "exact" }).eq("status", "active");

  if (params.kind) query = query.eq("kind", params.kind);
  if (params.category) {
    // listings.category is free text written over time with mixed casing;
    // match the selected category name case-insensitively (exact match,
    // LIKE wildcards in the name itself are escaped).
    const safeCategory = params.category.replace(/[%_\\]/g, (c) => `\\${c}`);
    query = query.ilike("category", safeCategory);
  }
  if (params.q) {
    const term = params.q.trim();
    const { data: matchedIds, error: matchError } = await sb.rpc("search_listing_ids", {
      p_query: term,
      p_limit: 500,
    });
    if (matchError) throw matchError;
    const ids = (matchedIds ?? []).map((row: any) => row.listing_id).filter(Boolean);
    if (!ids.length) return { items: [], total: 0, page, perPage };
    query = query.in("id", ids);
  }

  switch (params.sort) {
    case "price_asc":
      query = query.order("price", { ascending: true });
      break;
    case "price_desc":
      query = query.order("price", { ascending: false });
      break;
    case "trending":
      query = query
        .order("sales_count", { ascending: false })
        .order("created_at", { ascending: false });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  const from = (page - 1) * perPage;
  const { data, error, count } = await query.range(from, from + perPage - 1);
  if (error) throw error;
  let items = await attachRatings(data ?? []);
  if (params.sort === "rating") {
    items = [...items].sort((a, b) => (b.rating_avg ?? -1) - (a.rating_avg ?? -1));
  }
  return { items, total: count ?? 0, page, perPage };
}

export async function fetchHomeSections() {
  const [trending, latest, best] = await Promise.all([
    sb
      .from("listings")
      .select(SELECT)
      .eq("status", "active")
      .order("sales_count", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
    sb
      .from("listings")
      .select(SELECT)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(8),
    sb
      .from("listings")
      .select(SELECT)
      .eq("status", "active")
      .order("sales_count", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(12),
  ]);
  if (trending.error || latest.error) {
    // The home page must still render (hero + empty states) when the
    // backend is unreachable or not configured yet — same pattern as
    // fetchTestimonials below, which returns [] on error.
    console.error("[market] fetchHomeSections failed", trending.error ?? latest.error);
    return { featured: [], trending: [], latest: [], categories: [], bestselling: [] };
  }

  const [trendingItems, latestItems] = await Promise.all([
    attachRatings(trending.data ?? []),
    attachRatings(latest.data ?? []),
  ]);

  const categories = new Map<string, number>();
  for (const l of latestItems.concat(trendingItems)) {
    if (!l.category) continue;
    categories.set(l.category, (categories.get(l.category) ?? 0) + 1);
  }

  const featured = [...trendingItems]
    .sort(
      (a, b) =>
        (b.rating_avg ?? 0) * 10 + b.sales_count - ((a.rating_avg ?? 0) * 10 + a.sales_count),
    )
    .slice(0, 3);

  // Bestsellers: all-time sales ranking. When the catalogue is large enough
  // the row skips the four products already shown in the Trending rail, so
  // the two sections don't just repeat each other; with only a handful of
  // sellers it shows the full chart. Empty until something has actually sold.
  let bestselling: CardListing[] = [];
  if (!best.error) {
    const pool = (await attachRatings(best.data ?? [])).filter((l) => l.sales_count > 0);
    const trendingShown = new Set(
      trendingItems
        .filter((t) => t.sales_count > 0)
        .slice(0, 4)
        .map((t) => t.id),
    );
    const remainder = pool.filter((l) => !trendingShown.has(l.id));
    bestselling = (remainder.length >= 4 ? remainder : pool).slice(0, 8);
  }

  return {
    featured,
    trending: trendingItems,
    latest: latestItems,
    categories: [...categories.entries()].map(([name, count]) => ({ name, count })),
    bestselling,
  };
}

export type CategoryTile = { name: string; icon: string | null };

/**
 * The marketplace's category taxonomy for discovery surfaces (home tiles).
 * Prefers the admin-managed `categories` table (active rows, admin order);
 * until that migration is applied it falls back to the platform's built-in
 * category list — the same taxonomy the sell form offers. Never throws.
 */
export async function fetchCategoryTiles(limit = 12): Promise<CategoryTile[]> {
  try {
    const { data, error } = await sb
      .from("categories")
      .select("name,icon,sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(limit);
    if (!error && data?.length) {
      return (data as any[]).map((c) => ({
        name: String(c.name),
        icon: typeof c.icon === "string" ? c.icon : null,
      }));
    }
  } catch {
    // Table not there yet — fall through to the built-in taxonomy.
  }
  return PRODUCT_CATEGORIES.slice(0, limit).map((name) => ({ name, icon: null }));
}

export type FeaturedDeveloper = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  headline: string | null;
  skills: string[];
  verified: boolean;
  listings: number;
  projects: number;
};

/**
 * Real public profiles that have something to show — published products,
 * website projects they were assigned to, a professional headline or
 * skills. Returns [] unless at least two such profiles exist, so the home
 * page never renders a near-empty "featured" section. The professional
 * profile columns arrive with the upgrade migration; before it is applied
 * the query falls back to the base columns and counts alone decide.
 */
export async function fetchFeaturedDevelopers(limit = 6): Promise<FeaturedDeveloper[]> {
  const baseCols = "id,display_name,username,avatar_url,bio,verified";
  let res = await sb.from("public_profiles").select(`${baseCols},headline,skills`).limit(200);
  if (res.error) {
    res = await sb.from("public_profiles").select(baseCols).limit(200);
  }
  if (res.error || !res.data?.length) return [];

  const [{ data: listingRows }, { data: takenRows }] = await Promise.all([
    sb.from("listings").select("seller_id").eq("status", "active"),
    sb.from("website_requests").select("taken_by").not("taken_by", "is", null),
  ]);
  const countBy = (rows: any[] | null, key: string) => {
    const map = new Map<string, number>();
    for (const r of rows ?? []) {
      const id = r?.[key];
      if (id) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  };
  const listingCounts = countBy(listingRows, "seller_id");
  const projectCounts = countBy(takenRows, "taken_by");

  const developers = (res.data as any[])
    .map((p) => ({
      id: p.id,
      display_name: p.display_name ?? null,
      username: p.username ?? null,
      avatar_url: p.avatar_url ?? null,
      bio: p.bio ?? null,
      headline: p.headline ?? null,
      skills: Array.isArray(p.skills) ? (p.skills as string[]) : [],
      verified: !!p.verified,
      listings: listingCounts.get(p.id) ?? 0,
      projects: projectCounts.get(p.id) ?? 0,
    }))
    .filter(
      (d) =>
        (d.display_name || d.username) &&
        (d.listings > 0 || d.projects > 0 || d.headline || d.skills.length > 0),
    )
    .sort((a, b) => b.projects + b.listings - (a.projects + a.listings) || b.listings - a.listings);

  if (developers.length < 2) return [];
  return developers.slice(0, limit);
}

export type Creator = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  products: number;
  followers: number;
  rating_avg: number | null;
};

export async function fetchTopCreators(limit = 6): Promise<Creator[]> {
  const { data: listings, error } = await sb
    .from("listings")
    .select(
      "id,seller_id,sales_count,public_profiles:public_profiles!listings_seller_public_fkey(id,display_name,username,avatar_url,bio)",
    )
    .eq("status", "active");
  if (error) {
    console.error("[market] fetchTopCreators failed", error);
    return [];
  }
  if (!listings?.length) return [];

  const byCreator = new Map<
    string,
    { profile: any; products: number; sales: number; ids: string[] }
  >();
  for (const l of listings as any[]) {
    if (!l.public_profiles) continue;
    const cur = byCreator.get(l.seller_id) ?? {
      profile: l.public_profiles,
      products: 0,
      sales: 0,
      ids: [],
    };
    cur.products += 1;
    cur.sales += Number(l.sales_count ?? 0);
    cur.ids.push(l.id);
    byCreator.set(l.seller_id, cur);
  }

  const ids = [...byCreator.keys()];
  const [{ data: follows }, { data: reviews }] = await Promise.all([
    sb.from("follows").select("creator_id").in("creator_id", ids),
    sb
      .from("reviews")
      .select("listing_id,rating")
      .in(
        "listing_id",
        listings.map((l: any) => l.id),
      ),
  ]);

  const followers = new Map<string, number>();
  for (const f of follows ?? [])
    followers.set(f.creator_id, (followers.get(f.creator_id) ?? 0) + 1);

  const listingToCreator = new Map<string, string>();
  for (const [cid, v] of byCreator) for (const id of v.ids) listingToCreator.set(id, cid);
  const ratings = new Map<string, { sum: number; n: number }>();
  for (const r of reviews ?? []) {
    const cid = listingToCreator.get(r.listing_id);
    if (!cid) continue;
    const cur = ratings.get(cid) ?? { sum: 0, n: 0 };
    cur.sum += r.rating;
    cur.n += 1;
    ratings.set(cid, cur);
  }

  return [...byCreator.entries()]
    .map(([cid, v]) => {
      const agg = ratings.get(cid);
      return {
        id: cid,
        display_name: v.profile.display_name,
        username: v.profile.username,
        avatar_url: v.profile.avatar_url,
        bio: v.profile.bio,
        products: v.products,
        followers: followers.get(cid) ?? 0,
        rating_avg: agg ? agg.sum / agg.n : null,
      };
    })
    .sort((a, b) => b.products - a.products || b.followers - a.followers)
    .slice(0, limit);
}

export type Testimonial = {
  id: string;
  rating: number;
  body: string;
  created_at: string;
  listing: { id: string; title: string } | null;
  author: {
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  } | null;
};

/** Real 4–5 star reviews with written text. Never synthesised. */
export async function fetchTestimonials(limit = 3): Promise<Testimonial[]> {
  const { data, error } = await sb
    .from("reviews")
    .select(
      "id,rating,body,created_at,listing_id,listings:listing_id(id,title),public_profiles:public_profiles!reviews_user_public_fkey(display_name,username,avatar_url)",
    )
    .gte("rating", 4)
    .not("body", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? [])
    .filter((r: any) => (r.body ?? "").trim().length > 24)
    .map((r: any) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      created_at: r.created_at,
      listing: r.listings ?? null,
      author: r.public_profiles ?? null,
    }));
}
