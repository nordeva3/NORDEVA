import { supabase } from "@/integrations/supabase/client";
import { useCallback, useEffect, useState } from "react";

// Generated DB types lag behind newly added tables; use a loose client here.
const sb = supabase as any;

export const RECENTLY_VIEWED_KEY = "lume-recently-viewed";

/* ------------------------------- wishlist ------------------------------- */

export async function fetchWishlistIds(userId: string): Promise<Set<string>> {
  const { data } = await sb.from("wishlists").select("listing_id").eq("user_id", userId);
  return new Set((data ?? []).map((r: any) => r.listing_id));
}

export async function toggleWishlist(userId: string, listingId: string, on: boolean) {
  if (on) {
    const { error } = await sb.from("wishlists").insert({ user_id: userId, listing_id: listingId });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
  } else {
    const { error } = await sb
      .from("wishlists")
      .delete()
      .eq("user_id", userId)
      .eq("listing_id", listingId);
    if (error) throw new Error(error.message);
  }
}

/* --------------------------------- cart --------------------------------- */

export async function fetchCartIds(userId: string): Promise<Set<string>> {
  const { data } = await sb.from("cart_items").select("listing_id").eq("user_id", userId);
  return new Set((data ?? []).map((r: any) => r.listing_id));
}

export async function recordAnalyticsEvent(
  eventName: string,
  input: {
    userId?: string | null;
    listingId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  await sb.from("analytics_events").insert({
    user_id: input.userId ?? null,
    listing_id: input.listingId ?? null,
    event_name: eventName,
    session_id:
      sessionStorage.getItem("lume-session-id") ??
      (() => {
        const id = crypto.randomUUID();
        sessionStorage.setItem("lume-session-id", id);
        return id;
      })(),
    path: window.location.pathname,
    referrer: document.referrer || null,
    utm_source: params.get("utm_source"),
    utm_medium: params.get("utm_medium"),
    utm_campaign: params.get("utm_campaign"),
    metadata: input.metadata ?? {},
  });
}

export async function addToCart(userId: string, listingId: string) {
  const { error } = await sb.from("cart_items").insert({ user_id: userId, listing_id: listingId });
  if (error && !error.message.includes("duplicate")) throw new Error(error.message);
  void recordAnalyticsEvent("add_to_cart", { userId, listingId });
}

export async function removeFromCart(userId: string, listingId: string) {
  const { error } = await sb
    .from("cart_items")
    .delete()
    .eq("user_id", userId)
    .eq("listing_id", listingId);
  if (error) throw new Error(error.message);
}

const LISTING_SELECT =
  "id,title,price,currency,kind,cover_url,category,description,sales_count,created_at,status,seller_id,public_profiles:public_profiles!listings_seller_public_fkey(id,display_name,username,avatar_url)";

export async function fetchSavedListings(userId: string, table: "wishlists" | "cart_items") {
  const { data } = await sb
    .from(table)
    .select(`id,created_at,listing_id,listings:listing_id(${LISTING_SELECT})`)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? [])
    .filter((r: any) => r.listings)
    .map((r: any) => ({
      rowId: r.id as string,
      listing: {
        ...r.listings,
        price: Number(r.listings.price),
        seller: r.listings.profiles ?? null,
      },
    }));
}

/* -------------------------------- views --------------------------------- */

/** Records at most one view per listing per browser session. */
export async function recordView(listingId: string) {
  if (typeof window === "undefined") return;
  const key = `lume-viewed-${listingId}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  const { data: auth } = await supabase.auth.getUser();
  await sb
    .from("listing_views")
    .insert({ listing_id: listingId, viewer_id: auth.user?.id ?? null });
  void recordAnalyticsEvent("view_item", { userId: auth.user?.id ?? null, listingId });
}

export function pushRecentlyViewed(listingId: string) {
  if (typeof window === "undefined") return;
  try {
    const prev: string[] = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) ?? "[]");
    const next = [listingId, ...prev.filter((id) => id !== listingId)].slice(0, 8);
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recently viewed is best-effort */
  }
}

export function readRecentlyViewed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export async function fetchListingsByIds(ids: string[]) {
  if (!ids.length) return [];
  const { data } = await sb
    .from("listings")
    .select(LISTING_SELECT)
    .in("id", ids)
    .eq("status", "active");
  const order = new Map(ids.map((id, i) => [id, i]));
  return (data ?? [])
    .map((r: any) => ({
      ...r,
      price: Number(r.price),
      sales_count: Number(r.sales_count ?? 0),
      seller: r.public_profiles ?? null,
      rating_avg: null,
      rating_count: 0,
    }))
    .sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/* ------------------------------- reports -------------------------------- */

export const REPORT_REASONS = [
  "Stolen or pirated product",
  "Misleading description",
  "Malware or unsafe files",
  "Seller doesn't own this product",
  "Prohibited or illegal content",
  "Other",
] as const;

export async function submitReport(input: {
  userId: string;
  listingId: string;
  reason: string;
  details: string;
}) {
  const { error } = await sb.from("reports").insert({
    reporter_id: input.userId,
    listing_id: input.listingId,
    reason: input.reason,
    details: input.details.trim() || null,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------ live counts ----------------------------- */

/** Signed-in user's live cart + wishlist counts for the nav. */
export function useCommerceCounts() {
  const [userId, setUserId] = useState<string | null>(null);
  const [counts, setCounts] = useState({ cart: 0, wishlist: 0 });

  const load = useCallback(async (uid: string) => {
    const [cart, wish] = await Promise.all([
      sb.from("cart_items").select("id", { count: "exact", head: true }).eq("user_id", uid),
      sb.from("wishlists").select("id", { count: "exact", head: true }).eq("user_id", uid),
    ]);
    setCounts({ cart: cart.count ?? 0, wishlist: wish.count ?? 0 });
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setUserId(s?.user?.id ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) {
      setCounts({ cart: 0, wishlist: 0 });
      return;
    }
    load(userId);
    const ch = supabase
      .channel("commerce-counts")
      .on("postgres_changes", { event: "*", schema: "public", table: "cart_items" }, () =>
        load(userId),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "wishlists" }, () =>
        load(userId),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, load]);

  return { userId, ...counts };
}
