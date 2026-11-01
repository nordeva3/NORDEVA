import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Globe, Code2, Heart, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/currencies";
import type { CardListing } from "@/lib/market";
import { fetchWishlistIds, toggleWishlist } from "@/lib/commerce";
import { getCurrentAppearance, subscribeToAppearance, type CardVariant } from "@/lib/appearance";
import { Avatar } from "./ui-kit";

export type { CardVariant };

/**
 * The appearance-configured card variant. Mirrors the subscription pattern
 * used by the homepage (initial value from the applied config, then live
 * updates on appearance changes). Components may override per-instance with
 * the `variant` prop on ListingCard.
 */
export function useCardVariant(): CardVariant {
  const [variant, setVariant] = useState<CardVariant>(() => getCurrentAppearance().cardVariant);
  useEffect(() => subscribeToAppearance((config) => setVariant(config.cardVariant)), []);
  return variant;
}

/* ------------------------------------------------------------------ */
/* Shared wishlist state — one fetch per signed-in session, every     */
/* card subscribes to the same snapshot instead of querying per card. */
/* ------------------------------------------------------------------ */

let wlUser: string | null | undefined = undefined; // undefined = not loaded yet
let wlIds: Set<string> = new Set();
let wlPromise: Promise<void> | null = null;
let wlAuthBound = false;
const wlListeners = new Set<() => void>();

function wlEmit() {
  wlListeners.forEach((fn) => fn());
}

function wlLoad(): Promise<void> {
  if (wlPromise) return wlPromise;
  wlPromise = (async () => {
    try {
      const { data } = await supabase.auth.getUser();
      wlUser = data.user?.id ?? null;
      wlIds = wlUser ? await fetchWishlistIds(wlUser) : new Set();
    } catch {
      wlUser = null;
      wlIds = new Set();
    }
    wlEmit();
  })().finally(() => {
    wlPromise = null;
  });
  return wlPromise;
}

function wlBindAuth() {
  if (wlAuthBound || typeof window === "undefined") return;
  wlAuthBound = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user?.id ?? null;
    if (uid !== wlUser) {
      wlUser = undefined;
      wlIds = new Set();
      wlEmit();
      void wlLoad();
    }
  });
}

function WishlistButton({
  listingId,
  className = "absolute right-3 top-3 z-10 size-8",
}: {
  listingId: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    wlListeners.add(fn);
    wlBindAuth();
    void wlLoad();
    return () => {
      wlListeners.delete(fn);
    };
  }, []);

  const active = wlIds.has(listingId);

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (wlUser === undefined) await wlLoad();
    if (!wlUser) {
      navigate({
        to: "/auth",
        search: { next: typeof window !== "undefined" ? window.location.pathname : "/" },
      });
      return;
    }
    const uid = wlUser;
    const next = !active;
    if (next) wlIds.add(listingId);
    else wlIds.delete(listingId);
    wlEmit();
    setBusy(true);
    try {
      await toggleWishlist(uid, listingId, next);
      toast.success(next ? "Saved to your wishlist" : "Removed from your wishlist");
    } catch {
      if (next) wlIds.delete(listingId);
      else wlIds.add(listingId);
      wlEmit();
      toast.error("Could not update your wishlist");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={active}
      aria-label={active ? "Remove from wishlist" : "Save to wishlist"}
      title={active ? "Remove from wishlist" : "Save to wishlist"}
      className={`grid place-items-center rounded-full border border-border/70 bg-background/70 backdrop-blur transition hover:bg-background disabled:opacity-60 ${className}`}
    >
      <Heart
        className={`size-4 transition-colors ${active ? "fill-lume text-lume" : "text-foreground/70"}`}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Shared card pieces                                                  */
/* ------------------------------------------------------------------ */

function KindBadge({ kind, className = "" }: { kind: CardListing["kind"]; className?: string }) {
  const KindIcon = kind === "website" ? Globe : Code2;
  return (
    <span
      className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest backdrop-blur ${className}`}
    >
      <KindIcon className="size-3 text-lume" />
      {kind}
    </span>
  );
}

function CoverImage({ l, className = "" }: { l: CardListing; className?: string }) {
  return l.cover_url ? (
    <img
      src={l.cover_url}
      alt={l.title}
      loading="lazy"
      className={`size-full object-cover transition-transform [transition-duration:var(--reveal-duration)] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.06] ${className}`}
    />
  ) : (
    <div className="size-full lume-gradient opacity-25" />
  );
}

function RatingMeta({ l, className = "" }: { l: CardListing; className?: string }) {
  return l.rating_count > 0 ? (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <Star className="size-3 fill-gold text-gold" />
      {l.rating_avg?.toFixed(1)}
      <span className="text-muted-foreground/60">({l.rating_count})</span>
    </span>
  ) : (
    <span className="text-muted-foreground/50">No reviews</span>
  );
}

function SalesMeta({ l }: { l: CardListing }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Download className="size-3" />
      {l.sales_count}
    </span>
  );
}

function SellerMeta({ l, size = 24 }: { l: CardListing; size?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={l.seller?.display_name} url={l.seller?.avatar_url} size={size} />
      <span className="truncate text-[11px] text-muted-foreground">
        {l.seller?.display_name ?? l.seller?.username ?? "Creator"}
      </span>
    </span>
  );
}

function CategoryChip({ category }: { category: string }) {
  return (
    <span className="rounded-full border border-border/60 bg-accent/25 px-2 py-0.5 text-[10px] text-muted-foreground">
      {category}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Variants                                                            */
/* ------------------------------------------------------------------ */

function StandardCard({ l }: { l: CardListing }) {
  return (
    <div className="lift group surface relative flex flex-col overflow-hidden">
      <Link
        to="/listing/$id"
        params={{ id: l.id }}
        className="relative block overflow-hidden aspect-[16/10] bg-muted"
        aria-label={l.title}
      >
        <CoverImage l={l} />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/10 to-transparent opacity-80" />
        <KindBadge kind={l.kind} />
      </Link>
      <WishlistButton listingId={l.id} />

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 flex-1 truncate font-medium leading-tight">
            <Link to="/listing/$id" params={{ id: l.id }} className="hover:underline">
              {l.title}
            </Link>
          </h3>
          <div className="shrink-0 text-sm font-semibold lume-text">
            {formatMoney(l.price, l.currency)}
          </div>
        </div>

        {l.description && (
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {l.description}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-1.5">
          {[l.category].filter(Boolean).map((t) => (
            <CategoryChip key={t as string} category={t as string} />
          ))}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <SellerMeta l={l} />
          <span className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
            <RatingMeta l={l} />
            <SalesMeta l={l} />
          </span>
        </div>
      </div>
    </div>
  );
}

function CompactCard({ l }: { l: CardListing }) {
  return (
    <div className="lift group surface relative flex flex-col overflow-hidden">
      <Link
        to="/listing/$id"
        params={{ id: l.id }}
        className="relative block overflow-hidden aspect-[16/10] bg-muted"
        aria-label={l.title}
      >
        <CoverImage l={l} />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/10 to-transparent opacity-80" />
        <KindBadge kind={l.kind} />
      </Link>
      <WishlistButton listingId={l.id} className="absolute right-2 top-2 z-10 size-7" />

      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
            <Link to="/listing/$id" params={{ id: l.id }} className="hover:underline">
              {l.title}
            </Link>
          </h3>
          <div className="shrink-0 text-sm font-semibold lume-text">
            {formatMoney(l.price, l.currency)}
          </div>
        </div>

        {l.category && (
          <div className="mt-2">
            <CategoryChip category={l.category} />
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <SellerMeta l={l} size={20} />
          <span className="flex shrink-0 items-center gap-2.5 text-[11px] text-muted-foreground">
            <RatingMeta l={l} />
            <SalesMeta l={l} />
          </span>
        </div>
      </div>
    </div>
  );
}

function FeaturedCard({ l, span }: { l: CardListing; span: boolean }) {
  return (
    <div
      className={`lift group surface relative flex flex-col overflow-hidden ${span ? "sm:col-span-2" : ""}`}
    >
      <Link
        to="/listing/$id"
        params={{ id: l.id }}
        className="relative block overflow-hidden aspect-[16/9] bg-muted"
        aria-label={l.title}
      >
        <CoverImage l={l} />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/10 to-transparent opacity-80" />
        <KindBadge kind={l.kind} />
      </Link>
      <WishlistButton listingId={l.id} className="absolute right-3 top-3 z-10 size-9" />

      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 flex-1 truncate text-lg font-medium leading-tight">
            <Link to="/listing/$id" params={{ id: l.id }} className="hover:underline">
              {l.title}
            </Link>
          </h3>
          <div className="shrink-0 text-base font-semibold lume-text">
            {formatMoney(l.price, l.currency)}
          </div>
        </div>

        {l.description && (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {l.description}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-1.5">
          {[l.category].filter(Boolean).map((t) => (
            <CategoryChip key={t as string} category={t as string} />
          ))}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <SellerMeta l={l} size={28} />
          <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
            <RatingMeta l={l} />
            <SalesMeta l={l} />
          </span>
        </div>
      </div>
    </div>
  );
}

function HorizontalCard({ l }: { l: CardListing }) {
  return (
    <div className="lift group surface relative flex overflow-hidden">
      <Link
        to="/listing/$id"
        params={{ id: l.id }}
        className="relative w-32 shrink-0 overflow-hidden bg-muted sm:w-48"
        aria-label={l.title}
      >
        <span className="absolute inset-0">
          <CoverImage l={l} />
        </span>
        <span className="absolute inset-0 bg-gradient-to-r from-transparent to-card/20" />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {l.kind}
              {l.category ? ` · ${l.category}` : ""}
            </div>
            <h3 className="mt-1 truncate font-medium leading-tight">
              <Link to="/listing/$id" params={{ id: l.id }} className="hover:underline">
                {l.title}
              </Link>
            </h3>
          </div>
          <WishlistButton listingId={l.id} className="relative z-10 size-8 shrink-0" />
        </div>

        {l.description && (
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {l.description}
          </p>
        )}

        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <SellerMeta l={l} size={20} />
            <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <RatingMeta l={l} />
              <SalesMeta l={l} />
            </span>
          </div>
          <div className="shrink-0 text-base font-semibold lume-text">
            {formatMoney(l.price, l.currency)}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorialCard({ l }: { l: CardListing }) {
  return (
    <div className="group relative flex flex-col">
      <Link
        to="/listing/$id"
        params={{ id: l.id }}
        className="relative block overflow-hidden rounded-[var(--radius)] aspect-[16/10] bg-muted"
        aria-label={l.title}
      >
        <CoverImage l={l} />
      </Link>
      <WishlistButton listingId={l.id} />

      <div className="flex flex-1 flex-col px-1 pt-4">
        <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-lume">
          {l.category ?? l.kind}
        </div>
        <h3 className="mt-1.5 font-display text-xl font-semibold leading-snug">
          <Link to="/listing/$id" params={{ id: l.id }} className="hover:underline">
            {l.title}
          </Link>
        </h3>

        {l.description && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {l.description}
          </p>
        )}

        <div className="mt-3 text-lg font-semibold">{formatMoney(l.price, l.currency)}</div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <SellerMeta l={l} />
          <span className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
            <RatingMeta l={l} />
            <SalesMeta l={l} />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function ListingCard({
  l,
  featured = false,
  variant,
}: {
  l: CardListing;
  featured?: boolean;
  variant?: CardVariant;
}) {
  const configVariant = useCardVariant();
  const resolved: CardVariant = variant ?? (featured ? "featured" : configVariant);

  switch (resolved) {
    case "compact":
      return <CompactCard l={l} />;
    case "featured":
      return <FeaturedCard l={l} span={featured} />;
    case "horizontal":
      return <HorizontalCard l={l} />;
    case "editorial":
      return <EditorialCard l={l} />;
    case "standard":
    default:
      return <StandardCard l={l} />;
  }
}
