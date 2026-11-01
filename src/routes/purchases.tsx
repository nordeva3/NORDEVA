import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, KeyRound, Package, Receipt } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { EmptyState } from "@/components/ui-kit";
import { FadeIn, RippleButton } from "@/components/motion";
import { formatMoney } from "@/lib/currencies";
import { getListingDownloadUrl } from "@/lib/downloads.functions";
import { PrivateDeliveryPanel } from "@/components/private-delivery";

const sb = supabase as any;

export const Route = createFileRoute("/purchases")({
  head: () => ({
    meta: [
      { title: "Your purchases — NORDEVA Marketplace" },
      {
        name: "description",
        content:
          "Every product you've bought on NORDEVA, with downloads and private delivery details.",
      },
      { property: "og:title", content: "Your purchases — NORDEVA Marketplace" },
      {
        property: "og:description",
        content: "Downloads and delivery details for everything you've bought.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PurchasesPage,
});

function PurchasesPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const getUrl = useServerFn(getListingDownloadUrl);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        const [{ data: rows }, { data: licenseRows }] = await Promise.all([
          sb
            .from("orders")
            .select("*, listings:listing_id(id,title,cover_url,kind,version)")
            .eq("buyer_id", uid)
            .order("created_at", { ascending: false }),
          sb
            .from("license_keys")
            .select(
              "id,listing_id,order_id,license_key,seats,used_seats,status,expires_at,created_at",
            )
            .eq("buyer_id", uid)
            .order("created_at", { ascending: false }),
        ]);
        setOrders(rows ?? []);
        setLicenses(licenseRows ?? []);
      }
      setReady(true);
    });
  }, []);

  const download = async (listingId: string) => {
    setBusy(listingId);
    try {
      const res = await getUrl({ data: { listing_id: listingId } });
      window.location.href = res.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start download");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
        <FadeIn>
          <h1 className="text-3xl font-semibold sm:text-4xl">Purchases</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your library: re-download files any time and open the creator's private delivery notes.
          </p>
        </FadeIn>

        {!ready ? null : !userId ? (
          <div className="mt-10">
            <EmptyState
              icon={<Receipt className="size-5" />}
              title="Sign in to see your purchases"
              action={
                <Link
                  to="/auth"
                  search={{ next: "/purchases" }}
                  className="glow-btn rounded-2xl lume-gradient px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Sign in
                </Link>
              }
            />
          </div>
        ) : orders.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              icon={<Package className="size-5" />}
              title="No purchases yet"
              body="Once you buy a product it appears here with its downloads and licence details."
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
          <div className="mt-10 space-y-4">
            {orders.map((o) => (
              <div key={o.id} className="depth-card p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="aspect-video w-full overflow-hidden rounded-2xl bg-muted sm:w-28">
                    {o.listings?.cover_url ? (
                      <img
                        src={o.listings.cover_url}
                        alt={o.listings.title}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="size-full lume-gradient opacity-25" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {o.listings ? (
                      <Link
                        to="/listing/$id"
                        params={{ id: o.listings.id }}
                        className="focus-ring block truncate font-medium hover:underline"
                      >
                        {o.listings.title}
                      </Link>
                    ) : (
                      <div className="truncate font-medium text-muted-foreground">
                        Removed product
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(o.created_at).toLocaleDateString()} ·{" "}
                      {formatMoney(Number(o.amount), o.currency)}
                      {o.listings?.version ? ` · v${o.listings.version}` : ""}
                    </div>
                  </div>
                  {o.listings && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <RippleButton
                        onClick={() => download(o.listings.id)}
                        disabled={busy === o.listings.id}
                        className="rounded-2xl lume-gradient px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        <Download className="size-3.5" />
                        {busy === o.listings.id ? "Preparing…" : "Download"}
                      </RippleButton>
                      <RippleButton
                        onClick={() => setOpenId(openId === o.id ? null : o.listings.id)}
                        className="rounded-2xl border border-border/70 px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        <KeyRound className="size-3.5" /> Private delivery
                      </RippleButton>
                    </div>
                  )}
                </div>

                {openId === o.listings?.id && (
                  <div className="mt-5 space-y-4">
                    <PrivateDeliveryPanel listingId={o.listings.id} />
                    {licenses
                      .filter((k) => k.order_id === o.id || k.listing_id === o.listings?.id)
                      .map((k) => (
                        <div
                          key={k.id}
                          className="rounded-2xl border border-border/60 bg-muted/20 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                                License key
                              </div>
                              <code className="mt-1 block text-sm font-medium tracking-wider">
                                {k.license_key}
                              </code>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {k.seats} seat{k.seats === 1 ? "" : "s"} · {k.status}
                            </span>
                          </div>
                          {k.expires_at && (
                            <div className="mt-2 text-[11px] text-muted-foreground">
                              Expires {new Date(k.expires_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
