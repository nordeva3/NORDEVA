import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const stripeSecret = () => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured on the server.");
  return key;
};

async function stripe(path: string, params: Record<string, string>, method = "POST") {
  const body = new URLSearchParams(params);
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeSecret()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : body,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(data?.error?.message || "Stripe request failed");
  return data;
}

export const validateCheckoutDiscounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        listingId: z.string().uuid(),
        amount: z.number().nonnegative(),
        currency: z.string().length(3),
        couponCode: z.string().trim().max(80).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    let discount = 0;
    let couponId: string | null = null;
    if (data.couponCode) {
      const { data: row, error } = await supabaseAdmin.rpc("validate_coupon", {
        p_code: data.couponCode,
        p_seller_id: (
          await supabaseAdmin.from("listings").select("seller_id").eq("id", data.listingId).single()
        ).data?.seller_id,
        p_amount: data.amount,
        p_currency: data.currency,
        p_buyer_id: context.userId,
      });
      if (error) throw new Error(error.message);
      const hit = Array.isArray(row) ? row[0] : row;
      if (!hit) throw new Error("Invalid coupon");
      discount = Number(hit.discount_amount || 0);
      couponId = hit.coupon_id;
    }
    return { discount, total: Math.max(0, Number((data.amount - discount).toFixed(2))), couponId };
  });

export const createStripeSubscriptionCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        listingId: z.string().uuid(),
        variantId: z.string().uuid().optional(),
        couponCode: z.string().trim().max(80).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: listing, error } = await supabaseAdmin
      .from("listings")
      .select("id,title,price,currency,status,seller_id")
      .eq("id", data.listingId)
      .single();
    if (error || !listing || listing.status !== "active") throw new Error("Product is unavailable");
    if (String(listing.currency).toUpperCase() !== "USD")
      throw new Error("NORDEVA checkout supports USD prices only.");
    if (listing.seller_id === context.userId)
      throw new Error("You cannot purchase your own product");
    const { data: details } = await supabaseAdmin
      .from("listing_product_details")
      .select("pricing_model,trial_days")
      .eq("listing_id", listing.id)
      .maybeSingle();
    if (details?.pricing_model !== "subscription")
      throw new Error("This product is not a subscription");
    let variant: any = null;
    if (data.variantId) {
      const { data: v } = await supabaseAdmin
        .from("product_variants")
        .select("id,name,price,currency,active,listing_id")
        .eq("id", data.variantId)
        .eq("listing_id", listing.id)
        .eq("active", true)
        .maybeSingle();
      variant = v;
    }
    const amount = Number(variant?.price ?? listing.price);
    if (!(amount > 0)) throw new Error("Subscription price must be greater than zero");
    const currency = String(listing.currency).toLowerCase();
    const { data: user } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const email = user.user?.email;
    if (!email) throw new Error("Verified email required");
    const appUrl = process.env.VITE_APP_URL || "http://localhost:3000";
    const params: Record<string, string> = {
      mode: "subscription",
      "line_items[0][price_data][currency]": currency,
      "line_items[0][price_data][product_data][name]": variant
        ? `${listing.title} — ${variant.name}`
        : listing.title,
      "line_items[0][price_data][unit_amount]": String(Math.round(amount * 100)),
      "line_items[0][price_data][recurring][interval]": "month",
      "line_items[0][quantity]": "1",
      customer_email: email,
      success_url: `${appUrl}/purchases?subscription=processing&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/checkout/${listing.id}${data.variantId ? `?variant=${data.variantId}&cancelled=1` : "?cancelled=1"}`,
      "metadata[listing_id]": listing.id,
      "metadata[variant_id]": data.variantId ?? "",
      "metadata[buyer_id]": context.userId,
    };
    if (Number(details?.trial_days) > 0)
      params["subscription_data[trial_period_days]"] = String(
        Math.min(Number(details.trial_days), 365),
      );
    const { data: sellerAccount } = await supabaseAdmin
      .from("seller_payment_accounts")
      .select("provider_account_id,charges_enabled,payouts_enabled")
      .eq("seller_id", listing.seller_id)
      .eq("provider", "stripe_connect")
      .maybeSingle();
    if (
      sellerAccount?.provider_account_id &&
      sellerAccount.charges_enabled &&
      sellerAccount.payouts_enabled
    ) {
      params["subscription_data[application_fee_percent]"] = "15";
      params["subscription_data[transfer_data][destination]"] = sellerAccount.provider_account_id;
      params["subscription_data[transfer_data][amount_percent]"] = "85";
    }
    const session = await stripe("/checkout/sessions", params);
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url, sessionId: session.id };
  });

export const createStripeConnectOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ countryCode: z.string().length(2).default("US") }).parse(data))
  .handler(async ({ data, context }) => {
    const existing = await supabaseAdmin
      .from("seller_payment_accounts")
      .select("*")
      .eq("seller_id", context.userId)
      .eq("provider", "stripe_connect")
      .maybeSingle();
    let accountId = existing.data?.provider_account_id as string | undefined;
    if (!accountId) {
      const account = await stripe("/accounts", {
        type: "express",
        country: data.countryCode.toUpperCase(),
        "capabilities[card_payments][requested]": "true",
        "capabilities[transfers][requested]": "true",
      });
      accountId = account.id;
      await supabaseAdmin.from("seller_payment_accounts").insert({
        seller_id: context.userId,
        provider: "stripe_connect",
        provider_account_id: account.id as string,
        country_code: data.countryCode.toUpperCase(),
      });
    }
    if (!accountId) throw new Error("Could not create the payout account");
    const appUrl = process.env.VITE_APP_URL || "http://localhost:3000";
    const link = await stripe("/account_links", {
      account: accountId,
      refresh_url: `${appUrl}/earnings?connect=refresh`,
      return_url: `${appUrl}/earnings?connect=return`,
      type: "account_onboarding",
    });
    return { url: link.url, accountId };
  });

export const syncStripeConnectAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: row } = await supabaseAdmin
      .from("seller_payment_accounts")
      .select("provider_account_id")
      .eq("seller_id", context.userId)
      .eq("provider", "stripe_connect")
      .maybeSingle();
    if (!row?.provider_account_id) throw new Error("Connect account not started");
    const account = await stripe(`/accounts/${row.provider_account_id}`, {}, "GET");
    await supabaseAdmin
      .from("seller_payment_accounts")
      .update({
        charges_enabled: Boolean(account.charges_enabled),
        payouts_enabled: Boolean(account.payouts_enabled),
        details_submitted: Boolean(account.details_submitted),
        onboarding_status: account.payouts_enabled
          ? "enabled"
          : account.details_submitted
            ? "restricted"
            : "pending",
        requirements: account.requirements ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq("seller_id", context.userId)
      .eq("provider", "stripe_connect");
    return {
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      requirements: account.requirements ?? {},
    };
  });

export const submitSellerVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        legalName: z.string().trim().max(160).optional(),
        countryCode: z.string().trim().length(2).optional(),
        taxId: z.string().trim().max(80).optional(),
        website: z.string().trim().url().max(300).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const existing = await supabaseAdmin
      .from("seller_verifications")
      .select("id,status")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data && ["verified", "suspended"].includes(String(existing.data.status)))
      throw new Error("This verification record can only be changed by marketplace staff.");
    const payload = {
      user_id: context.userId,
      status: "pending",
      legal_name: data.legalName || null,
      country_code: data.countryCode?.toUpperCase() || null,
      tax_id: data.taxId || null,
      website: data.website || null,
      notes: null,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: new Date().toISOString(),
    };
    const { data: row, error } = await supabaseAdmin
      .from("seller_verifications")
      .upsert(payload, { onConflict: "user_id" })
      .select("id,user_id,status,legal_name,country_code,website,updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const enqueueEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        to: z.string().email(),
        template: z.enum([
          "purchase_receipt",
          "refund_update",
          "seller_approved",
          "seller_rejected",
          "payout_update",
          "security_alert",
          "product_update",
          "support_update",
        ]),
        subject: z.string().min(1).max(200),
        payload: z.record(z.any()).default({}),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Admin access required");
    const { error } = await supabaseAdmin.from("email_outbox").insert({
      recipient_email: data.to,
      template_key: data.template,
      subject: data.subject,
      payload: data.payload,
    });
    if (error) throw new Error(error.message);
    return { queued: true };
  });
