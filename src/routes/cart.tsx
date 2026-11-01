import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Heart, ShieldCheck, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { EmptyState } from "@/components/ui-kit";
import { FadeIn, RippleButton } from "@/components/motion";
import { formatMoney } from "@/lib/currencies";
import { fetchSavedListings, removeFromCart, toggleWishlist } from "@/lib/commerce";

export const Route = createFileRoute("/cart")({
  head: () => ({
    meta: [
      { title: "Your cart — NORDEVA Marketplace" },
      {
        name: "description",
        content: "Review the products in your NORDEVA Marketplace cart before checkout.",
      },
      { property: "og:title", content: "Your cart — NORDEVA Marketplace" },
      {
        property: "og:description",
        content: "Review the products in your NORDEVA Marketplace cart.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CartPage,
});

function CartPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Array<{ rowId: string; listing: any }>>([]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (uid) setRows(await fetchSavedListings(uid, "cart_items"));
      setReady(true);
    });
  }, []);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows)
      map.set(r.listing.currency, (map.get(r.listing.currency) ?? 0) + r.listing.price);
    return [...map.entries()];
  }, [rows]);

  const drop = async (listingId: string) => {
    if (!userId) return;
    await removeFromCart(userId, listingId);
    setRows((r) => r.filter((x) => x.listing.id !== listingId));
    toast.success("Removed from cart");
  };

  const save = async (listingId: string) => {
    if (!userId) return;
    await toggleWishlist(userId, listingId, true);
    await removeFromCart(userId, listingId);
    setRows((r) => r.filter((x) => x.listing.id !== listingId));
    toast.success("Saved to wishlist");
  };

  return (
    <div className="relative min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <FadeIn>
          <h1 className="text-3xl font-semibold sm:text-4xl">Your cart</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Each product is delivered instantly after its own secure checkout.
          </p>
        </FadeIn>

        {!ready ? null : !userId ? (
          <div className="mt-10">
            <EmptyState
              icon={<ShoppingBag className="size-5" />}
              title="Sign in to use your cart"
              body="Your cart follows your account across devices."
              action={
                <Link
                  to="/auth"
                  search={{ next: "/cart" }}
                  className="glow-btn rounded-2xl lume-gradient px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Sign in
                </Link>
              }
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              icon={<ShoppingBag className="size-5" />}
              title="Your cart is empty"
              body="Find something you love in the marketplace."
              action={
                <Link
                  to="/browse"
                  search={{}}
                  className="glow-btn rounded-2xl lume-gradient px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Browse marketplace
                </Link>
              }
            />
          </div>
        ) : (
          <div className="mt-10 grid gap-8 lg:grid-cols-[1.7fr_1fr]">
            <ul className="space-y-4">
              {rows.map((r) => (
                <li
                  key={r.rowId}
                  className="depth-card flex flex-col gap-4 p-4 sm:flex-row sm:items-center"
                >
                  <div className="aspect-video w-full overflow-hidden rounded-2xl bg-muted sm:w-32">
                    {r.listing.cover_url ? (
                      <img
                        src={r.listing.cover_url}
                        alt={r.listing.title}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="size-full lume-gradient opacity-25" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/listing/$id"
                      params={{ id: r.listing.id }}
                      className="focus-ring block truncate font-medium hover:underline"
                    >
                      {r.listing.title}
                    </Link>
                    <div className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
                      {r.listing.kind}
                      {r.listing.category ? ` · ${r.listing.category}` : ""}
                    </div>
                    <div className="mt-2 text-sm font-semibold lume-text">
                      {formatMoney(r.listing.price, r.listing.currency)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      to="/checkout/$id"
                      params={{ id: r.listing.id }}
                      search={{ variant: undefined }}
                      className="glow-btn rounded-2xl lume-gradient px-4 py-2.5 text-xs font-semibold text-white"
                    >
                      Buy now
                    </Link>
                    <RippleButton
                      onClick={() => save(r.listing.id)}
                      aria-label={`Save ${r.listing.title} to wishlist`}
                      className="grid size-11 place-items-center rounded-2xl border border-border/70 text-muted-foreground hover:text-lume"
                    >
                      <Heart className="size-4" />
                    </RippleButton>
                    <RippleButton
                      onClick={() => drop(r.listing.id)}
                      aria-label={`Remove ${r.listing.title} from cart`}
                      className="grid size-11 place-items-center rounded-2xl border border-border/70 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </RippleButton>
                  </div>
                </li>
              ))}
            </ul>

            <aside className="depth-card h-fit p-6 lg:sticky lg:top-24">
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Summary
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Items</span>
                  <span>{rows.length}</span>
                </div>
                {totals.map(([currency, amount]) => (
                  <div key={currency} className="flex justify-between">
                    <span className="text-muted-foreground">Total ({currency})</span>
                    <span className="font-semibold lume-text">{formatMoney(amount, currency)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                Products are sold by independent creators in their own currency, so each item checks
                out separately. Use <span className="text-foreground">Buy now</span> on any item to
                complete it.
              </p>
              <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3.5 text-lume" /> Files are delivered by signed private
                link
              </p>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
