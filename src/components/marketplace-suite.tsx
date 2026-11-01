import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { toast } from "sonner";
import {
  BadgePercent,
  BarChart3,
  Code2,
  Headphones,
  KeyRound,
  MessageSquare,
  ShieldCheck,
  Store,
  WalletCards,
} from "lucide-react";
import { submitSellerVerification } from "@/lib/production-completion.functions";
import { useServerFn } from "@tanstack/react-start";

export function MarketplaceSuite({ userId, listings }: { userId: string; listings: any[] }) {
  const [couponCode, setCouponCode] = useState("");
  const [couponValue, setCouponValue] = useState("10");
  const [couponType, setCouponType] = useState("percent");
  const [variantListing, setVariantListing] = useState(listings[0]?.id ?? "");
  const [variantName, setVariantName] = useState("");
  const [variantPrice, setVariantPrice] = useState("");

  const [questionListing, setQuestionListing] = useState(listings[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketBody, setTicketBody] = useState("");
  const [taxCountry, setTaxCountry] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [apiKeyName, setApiKeyName] = useState("");
  const [analytics, setAnalytics] = useState<any[]>([]);
  const [verification, setVerification] = useState<any>(null);
  const [affiliate, setAffiliate] = useState<any>(null);
  const [prefs, setPrefs] = useState({
    product_updates: true,
    order_emails: true,
    marketing_emails: false,
    messages: true,
    security_alerts: true,
  });
  const [busy, setBusy] = useState(false);
  const submitVerification = useServerFn(submitSellerVerification);

  const listingOptions = useMemo(
    () => listings.map((l) => ({ id: l.id, title: l.title })),
    [listings],
  );

  useEffect(() => {
    if (!variantListing && listings[0]?.id) setVariantListing(listings[0].id);
    if (!questionListing && listings[0]?.id) setQuestionListing(listings[0].id);
    void (async () => {
      const [{ data: a }, { data: v }, { data: ap }, { data: p }] = await Promise.all([
        supabase
          .from("analytics_events")
          .select("event_name,created_at,listing_id,path,utm_source")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(25),
        supabase.from("seller_verifications").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("affiliate_programs").select("*").eq("seller_id", userId).maybeSingle(),
        supabase.from("notification_preferences").select("*").eq("user_id", userId).maybeSingle(),
      ]);
      setAnalytics(a ?? []);
      setVerification(v ?? null);
      setAffiliate(ap ?? null);
      if (p)
        setPrefs({
          product_updates: p.product_updates,
          order_emails: p.order_emails,
          marketing_emails: p.marketing_emails,
          messages: p.messages,
          security_alerts: p.security_alerts,
        });
    })();
  }, [userId, listings, variantListing, questionListing]);

  const createCoupon = async () => {
    if (!couponCode.trim()) return toast.error("Enter a coupon code");
    setBusy(true);
    const { error } = await supabase.from("coupons").insert({
      seller_id: userId,
      code: couponCode.trim().toUpperCase(),
      discount_type: couponType,
      discount_value: Number(couponValue),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setCouponCode("");
    toast.success("Coupon created");
  };

  const createVariant = async () => {
    if (!variantListing || !variantName || Number(variantPrice) <= 0)
      return toast.error("Choose a product and enter variant details");
    setBusy(true);
    const { error } = await supabase.from("product_variants").insert({
      listing_id: variantListing,
      name: variantName,
      price: Number(variantPrice),
      currency: "USD",
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setVariantName("");
    setVariantPrice("");
    toast.success("Product variant added");
  };

  const askQuestion = async () => {
    if (!questionListing || !question.trim())
      return toast.error("Choose a product and enter a question");
    setBusy(true);
    const { error } = await supabase
      .from("product_questions")
      .insert({ listing_id: questionListing, user_id: userId, question: question.trim() });
    setBusy(false);
    if (error) return toast.error(error.message);
    setQuestion("");
    toast.success("Question posted");
  };

  const createTicket = async () => {
    if (!ticketSubject.trim() || !ticketBody.trim())
      return toast.error("Enter a support subject and message");
    setBusy(true);
    const { data, error } = await supabase
      .from("support_tickets")
      .insert({ user_id: userId, subject: ticketSubject.trim(), category: "general" })
      .select("id")
      .single();
    if (!error && data)
      await supabase
        .from("support_messages")
        .insert({ ticket_id: data.id, sender_id: userId, body: ticketBody.trim() });
    setBusy(false);
    if (error) return toast.error(error.message);
    setTicketSubject("");
    setTicketBody("");
    toast.success("Support ticket created");
  };

  const saveVerification = async () => {
    setBusy(true);
    try {
      const row = await submitVerification({ data: {} });
      setVerification(row);
      toast.success("Verification request submitted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Verification request failed");
    } finally {
      setBusy(false);
    }
  };

  const saveAffiliate = async () => {
    setBusy(true);
    const { error } = await supabase
      .from("affiliate_programs")
      .upsert(
        { seller_id: userId, commission_percent: 10, active: true },
        { onConflict: "seller_id" },
      );
    setBusy(false);
    if (error) return toast.error(error.message);
    setAffiliate({ seller_id: userId, commission_percent: 10, active: true });
    toast.success("Affiliate program enabled");
  };

  const createApiKey = async () => {
    if (!apiKeyName.trim()) return toast.error("Name your API key");
    const raw = `velora_${crypto.randomUUID().replaceAll("-", "")}_${crypto.randomUUID().replaceAll("-", "")}`;
    const bytes = new TextEncoder().encode(raw);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const { error } = await supabase.from("api_keys").insert({
      user_id: userId,
      name: apiKeyName.trim(),
      key_prefix: raw.slice(0, 12),
      key_hash: hash,
    });
    if (error) return toast.error(error.message);
    setApiKeyName("");
    window.prompt("Copy this API key now. NORDEVA stores only its hash:", raw);
  };

  const saveTax = async () => {
    setBusy(true);
    const { error } = await supabase.from("tax_profiles").upsert(
      {
        user_id: userId,
        country_code: taxCountry.trim().toUpperCase(),
        tax_number: taxNumber.trim(),
      },
      { onConflict: "user_id" },
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Tax profile saved");
  };

  const savePrefs = async () => {
    setBusy(true);
    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, ...prefs }, { onConflict: "user_id" });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Notification preferences saved");
  };

  const panel = (title: string, icon: any, children: ReactNode) => (
    <section className="surface p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lume">{icon}</span>
        <h3 className="font-medium">{title}</h3>
      </div>
      {children}
    </section>
  );

  return (
    <div className="mt-12 space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Marketplace Suite</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Global commerce controls added without replacing your existing NORDEVA features.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {panel(
          "Coupons & discounts",
          <BadgePercent className="size-5" />,
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              placeholder="SAVE10"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
            />
            <Input
              type="number"
              min="1"
              value={couponValue}
              onChange={(e) => setCouponValue(e.target.value)}
            />
            <Select value={couponType} onValueChange={setCouponType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percent</SelectItem>
                <SelectItem value="fixed">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
            <Button disabled={busy} onClick={createCoupon} className="sm:col-span-3">
              Create coupon
            </Button>
          </div>,
        )}
        {panel(
          "Product variants / tiers",
          <Store className="size-5" />,
          <div className="space-y-3">
            <Select value={variantListing} onValueChange={setVariantListing}>
              <SelectTrigger>
                <SelectValue placeholder="Product" />
              </SelectTrigger>
              <SelectContent>
                {listingOptions.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="Pro / Lifetime"
                value={variantName}
                onChange={(e) => setVariantName(e.target.value)}
              />
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Price"
                value={variantPrice}
                onChange={(e) => setVariantPrice(e.target.value)}
              />
            </div>
            <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm">
              USD
            </div>
            <Button disabled={busy} onClick={createVariant}>
              Add variant
            </Button>
          </div>,
        )}
        {panel(
          "Product Q&A",
          <MessageSquare className="size-5" />,
          <div className="space-y-3">
            <Select value={questionListing} onValueChange={setQuestionListing}>
              <SelectTrigger>
                <SelectValue placeholder="Product" />
              </SelectTrigger>
              <SelectContent>
                {listingOptions.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Ask a public product question…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <Button disabled={busy} onClick={askQuestion}>
              Post question
            </Button>
          </div>,
        )}
        {panel(
          "Support tickets",
          <Headphones className="size-5" />,
          <div className="space-y-3">
            <Input
              placeholder="Subject"
              value={ticketSubject}
              onChange={(e) => setTicketSubject(e.target.value)}
            />
            <Textarea
              placeholder="Describe the issue…"
              value={ticketBody}
              onChange={(e) => setTicketBody(e.target.value)}
            />
            <Button disabled={busy} onClick={createTicket}>
              Open ticket
            </Button>
          </div>,
        )}
        {panel(
          "Seller verification / KYC",
          <ShieldCheck className="size-5" />,
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium capitalize">{verification?.status ?? "unverified"}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Verification status is stored server-side. Admin review can approve or reject it.
              </p>
            </div>
            <Button
              disabled={
                busy || verification?.status === "pending" || verification?.status === "verified"
              }
              onClick={saveVerification}
            >
              Request verification
            </Button>
          </div>,
        )}
        {panel(
          "Affiliate program",
          <WalletCards className="size-5" />,
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">
                {affiliate?.active ? `${affiliate.commission_percent}% commission` : "Not enabled"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Create an affiliate program for your products.
              </p>
            </div>
            <Button disabled={busy || affiliate?.active} onClick={saveAffiliate}>
              {affiliate?.active ? "Enabled" : "Enable"}
            </Button>
          </div>,
        )}
        {panel(
          "Developer API",
          <Code2 className="size-5" />,
          <div className="flex gap-3">
            <Input
              placeholder="API key name"
              value={apiKeyName}
              onChange={(e) => setApiKeyName(e.target.value)}
            />
            <Button onClick={createApiKey}>
              <KeyRound className="size-4 mr-1" />
              Create
            </Button>
          </div>,
        )}
        {panel(
          "Tax profile",
          <WalletCards className="size-5" />,
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              placeholder="Country code (IN, US…)"
              maxLength={2}
              value={taxCountry}
              onChange={(e) => setTaxCountry(e.target.value)}
            />
            <Input
              placeholder="Tax / GST / VAT number"
              value={taxNumber}
              onChange={(e) => setTaxNumber(e.target.value)}
            />
            <Button disabled={busy} onClick={saveTax} className="sm:col-span-2">
              Save tax profile
            </Button>
          </div>,
        )}
        {panel(
          "Notifications",
          <MessageSquare className="size-5" />,
          <div className="space-y-2 text-sm">
            {Object.entries(prefs).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={v}
                  onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.checked }))}
                />
                <span>{k.replaceAll("_", " ")}</span>
              </label>
            ))}
            <Button disabled={busy} onClick={savePrefs} className="mt-2">
              Save preferences
            </Button>
          </div>,
        )}
      </div>
      {panel(
        "Analytics & conversion events",
        <BarChart3 className="size-5" />,
        <div className="max-h-64 overflow-auto divide-y divide-border/60">
          {analytics.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No tracked events yet. Product views, cart events and purchases can be recorded here
              as traffic grows.
            </div>
          ) : (
            analytics.map((e, i) => (
              <div key={i} className="py-2 flex justify-between gap-4 text-xs">
                <span>{e.event_name}</span>
                <span className="text-muted-foreground">
                  {new Date(e.created_at).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>,
      )}
    </div>
  );
}
