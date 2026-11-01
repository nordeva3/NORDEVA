import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Heart, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { EmptyState } from "@/components/ui-kit";
import { FadeIn, RippleButton, Stagger, StaggerItem } from "@/components/motion";
import { ListingCard } from "@/components/listing-card";
import { addToCart, fetchSavedListings, toggleWishlist } from "@/lib/commerce";

export const Route = createFileRoute("/wishlist")({
  head: () => ({
    meta: [
      { title: "Your wishlist — NORDEVA Marketplace" },
      {
        name: "description",
        content: "Products you saved on NORDEVA Marketplace, ready when you are.",
      },
      { property: "og:title", content: "Your wishlist — NORDEVA Marketplace" },
      { property: "og:description", content: "Products you saved on NORDEVA Marketplace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WishlistPage,
});

function WishlistPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Array<{ rowId: string; listing: any }>>([]);

  const load = async (uid: string) => {
    setRows(await fetchSavedListings(uid, "wishlists"));
    setReady(true);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (uid) load(uid);
      else setReady(true);
    });
  }, []);

  const remove = async (listingId: string) => {
    if (!userId) return;
    await toggleWishlist(userId, listingId, false);
    setRows((r) => r.filter((x) => x.listing.id !== listingId));
    toast.success("Removed from wishlist");
  };

  const moveToCart = async (listingId: string) => {
    if (!userId) return;
    await addToCart(userId, listingId);
    await toggleWishlist(userId, listingId, false);
    setRows((r) => r.filter((x) => x.listing.id !== listingId));
    toast.success("Moved to cart");
  };

  return (
    <div className="relative min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <FadeIn>
          <h1 className="text-3xl font-semibold sm:text-4xl">Wishlist</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Everything you've saved. Move an item to your cart when you're ready to buy.
          </p>
        </FadeIn>

        {!ready ? null : !userId ? (
          <div className="mt-10">
            <EmptyState
              icon={<Heart className="size-5" />}
              title="Sign in to use your wishlist"
              body="Your saved products sync across every device once you're signed in."
              action={
                <Link
                  to="/auth"
                  search={{ next: "/wishlist" }}
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
              icon={<Heart className="size-5" />}
              title="Nothing saved yet"
              body="Tap the heart on any product to keep it here."
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
          <Stagger className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <StaggerItem key={r.rowId}>
                <div className="flex h-full flex-col">
                  <ListingCard l={r.listing} />
                  <div className="mt-3 flex gap-2">
                    <RippleButton
                      onClick={() => moveToCart(r.listing.id)}
                      className="flex-1 rounded-2xl lume-gradient px-4 py-2.5 text-xs font-semibold text-white"
                    >
                      <ShoppingBag className="size-3.5" /> Move to cart
                    </RippleButton>
                    <RippleButton
                      onClick={() => remove(r.listing.id)}
                      aria-label={`Remove ${r.listing.title} from wishlist`}
                      className="grid size-11 place-items-center rounded-2xl border border-border/70 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </RippleButton>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>
    </div>
  );
}
