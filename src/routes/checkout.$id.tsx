import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/currencies";
import { LockKeyhole, ShieldCheck, Tag } from "lucide-react";
import { toast } from "sonner";
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  createStripeCheckoutSession,
  getPaymentProvider,
} from "@/lib/payment.functions";
import { createStripeSubscriptionCheckout } from "@/lib/production-completion.functions";
import { recordAnalyticsEvent } from "@/lib/commerce";

export const Route = createFileRoute("/checkout/$id")({
  validateSearch: (search: Record<string, unknown>) => ({
    variant: typeof search.variant === "string" ? search.variant : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Checkout — NORDEVA" },
      { name: "description", content: "Complete your purchase on NORDEVA." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Checkout,
});

// Razorpay checkout is enabled only when server credentials are configured.
// The server creates the provider order; the client never creates a completed NORDEVA order.
const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

function Checkout() {
  const { id } = Route.useParams();
  const { variant: variantId } = Route.useSearch();
  const [listing, setListing] = useState<any>(null);
  const [variant, setVariant] = useState<any>(null);
  const [details, setDetails] = useState<any>(null);
  const [couponCode, setCouponCode] = useState("");
  const [pwywAmount, setPwywAmount] = useState("");
  const [email, setEmail] = useState("");
  const [processing, setProcessing] = useState(false);
  const [provider, setProvider] = useState<"stripe" | "razorpay" | null>(null);
  const createOrder = useServerFn(createRazorpayOrder);
  const verifyPayment = useServerFn(verifyRazorpayPayment);
  const createStripe = useServerFn(createStripeCheckoutSession);
  const createSubscription = useServerFn(createStripeSubscriptionCheckout);
  const resolveProvider = useServerFn(getPaymentProvider);

  useEffect(() => {
    resolveProvider({})
      .then((result) => setProvider(result.provider))
      .catch(() => setProvider(null));
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setEmail(data.user.email);
    });
    supabase
      .from("listings")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => setListing(data));
    supabase
      .from("listing_product_details")
      .select("pricing_model,pay_what_you_want,minimum_price,trial_days")
      .eq("listing_id", id)
      .maybeSingle()
      .then(({ data }) => setDetails(data));
    if (variantId)
      supabase
        .from("product_variants")
        .select("id,name,price,currency,active,listing_id")
        .eq("id", variantId)
        .eq("listing_id", id)
        .eq("active", true)
        .maybeSingle()
        .then(({ data }) => setVariant(data));
  }, [id]);

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!listing || processing) return;
    setProcessing(true);
    try {
      const selectedProvider = provider ?? (await resolveProvider({})).provider;
      const checkoutData = {
        listing_id: id,
        variant_id: variantId,
        coupon_code: couponCode.trim() || undefined,
        pay_what_you_want: pwywAmount ? Number(pwywAmount) : undefined,
      };
      if (selectedProvider === "stripe" && details?.pricing_model === "subscription") {
        const session = await createSubscription({
          data: { listingId: id, variantId, couponCode: couponCode.trim() || undefined },
        });
        window.location.assign(session.url);
        return;
      }
      if (selectedProvider === "stripe") {
        const session = await createStripe({ data: checkoutData });
        window.location.assign(session.url);
        return;
      }

      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>(
            `script[src="${RAZORPAY_SCRIPT}"]`,
          );
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener(
              "error",
              () => reject(new Error("Could not load secure payment checkout")),
              { once: true },
            );
            return;
          }
          const script = document.createElement("script");
          script.src = RAZORPAY_SCRIPT;
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Could not load secure payment checkout"));
          document.body.appendChild(script);
        });
      }

      const order = await createOrder({ data: checkoutData });
      if (!window.Razorpay) throw new Error("Secure checkout is unavailable");

      const razorpay = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        description: order.description,
        order_id: order.orderId,
        prefill: { email: order.email },
        theme: { color: "#8b5cf6" },
        modal: { ondismiss: () => setProcessing(false) },
        handler: async (response) => {
          try {
            await verifyPayment({
              data: {
                listing_id: id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                variant_id: variantId,
              },
            });
            const { data: auth } = await supabase.auth.getUser();
            void recordAnalyticsEvent("purchase", {
              userId: auth.user?.id ?? null,
              listingId: id,
              metadata: {
                currency: listing.currency,
                amount: Number(variant?.price ?? listing.price),
                variantId: variantId ?? null,
              },
            });
            toast.success("Payment verified. Your purchase is ready.");
            window.location.href = "/purchases";
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Payment verification failed");
            setProcessing(false);
          }
        },
      });
      razorpay.open();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start checkout");
      setProcessing(false);
    }
  };

  if (!listing)
    return (
      <div className="min-h-screen">
        <TopNav />
      </div>
    );

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-4xl px-4 py-10 grid md:grid-cols-[1fr_360px] gap-8">
        <form onSubmit={pay} className="space-y-6">
          <h1 className="text-2xl font-semibold">Checkout</h1>

          <div className="rounded-2xl border border-lume/30 bg-lume/10 p-5">
            <div className="flex items-center gap-2 font-medium">
              <LockKeyhole className="size-4 text-lume" /> Secure checkout
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Your order is created only after the payment provider confirms payment. No fake or
              client-created “successful” orders are allowed.
            </p>
          </div>

          <div>
            <Label>Email (for receipt & delivery)</Label>
            <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          {details?.pricing_model === "pay_what_you_want" && details?.pay_what_you_want && (
            <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
              <Label>Your price</Label>
              <Input
                type="number"
                min={Number(details.minimum_price ?? 0)}
                step="0.01"
                required
                value={pwywAmount}
                onChange={(e) => setPwywAmount(e.target.value)}
                placeholder={`Minimum ${formatMoney(Number(details.minimum_price ?? 0), listing.currency)}`}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Pay what you want, with a minimum of{" "}
                {formatMoney(Number(details.minimum_price ?? 0), listing.currency)}.
              </p>
            </div>
          )}
          <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
            <Label className="flex items-center gap-2">
              <Tag className="size-4" /> Coupon code
            </Label>
            <Input
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              placeholder="Optional discount code"
              autoCapitalize="characters"
            />
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 text-lume" />
              <div>
                <div className="text-sm font-medium">
                  Protected {provider === "stripe" ? "Stripe" : "Razorpay"} checkout
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Payment is verified by the payment provider and confirmed server-side before your
                  NORDEVA purchase is created.
                </p>
              </div>
            </div>
          </div>

          <Button
            type="submit"
            loading={processing}
            className="w-full lume-gradient text-white hover:opacity-90 disabled:opacity-50"
          >
            {details?.pricing_model === "subscription"
              ? `Start subscription — ${formatMoney(Number(variant?.price ?? listing.price), listing.currency)}/month`
              : `Pay ${formatMoney(Number(pwywAmount || variant?.price || listing.price), listing.currency)}`}
          </Button>
        </form>

        <aside className="rounded-2xl border border-border/60 bg-card p-6 h-fit">
          <div className="aspect-video rounded-lg overflow-hidden bg-muted mb-4">
            {listing.cover_url ? (
              <img src={listing.cover_url} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full lume-gradient opacity-20" />
            )}
          </div>
          <div className="text-sm font-medium">{listing.title}</div>
          {variant && <div className="mt-1 text-xs text-lume">Tier: {variant.name}</div>}
          <div className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            {listing.kind}
          </div>
          <div className="mt-4 pt-4 border-t border-border/60 flex justify-between items-baseline">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-xl font-semibold lume-text">
              {formatMoney(Number(variant?.price ?? listing.price), listing.currency)}
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
