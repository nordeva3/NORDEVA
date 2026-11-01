import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toMinorUnits } from "@/lib/currencies";

const PLATFORM_FEE_RATE = 0.15;

function generateLicenseKey() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let raw = "";
  for (const b of bytes) raw += alphabet[b % alphabet.length];
  return `NORDEVA-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
}

async function issueLicenseIfNeeded(
  admin: any,
  orderId: string,
  listingId: string,
  buyerId: string,
) {
  const { data: details } = await admin
    .from("listing_product_details")
    .select("license_type,license_seats,license_duration_days")
    .eq("listing_id", listingId)
    .maybeSingle();
  if (!details || ["none", "no_license"].includes(String(details.license_type).toLowerCase()))
    return;
  const { data: existing } = await admin
    .from("license_keys")
    .select("id")
    .eq("order_id", orderId)
    .limit(1)
    .maybeSingle();
  if (existing) return;
  const expires = details.license_duration_days
    ? new Date(Date.now() + Number(details.license_duration_days) * 86400000).toISOString()
    : null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await admin.from("license_keys").insert({
      listing_id: listingId,
      order_id: orderId,
      buyer_id: buyerId,
      license_key: generateLicenseKey(),
      seats: Math.max(1, Number(details.license_seats ?? 1)),
      expires_at: expires,
    });
    if (!error) return;
    if (!String(error.message).toLowerCase().includes("duplicate")) throw new Error(error.message);
  }
}

async function resolveCheckoutPrice(
  admin: any,
  listing: any,
  variant: any,
  buyerId: string,
  couponCode?: string,
  payWhatYouWant?: number,
) {
  const gross = Number(variant?.price ?? listing.price);
  let final = gross;
  let couponId: string | null = null;
  let discount = 0;
  if (payWhatYouWant !== undefined) {
    const minimum = await admin
      .from("listing_product_details")
      .select("pricing_model,pay_what_you_want,minimum_price")
      .eq("listing_id", listing.id)
      .maybeSingle();
    if (minimum.data?.pricing_model !== "pay_what_you_want" || !minimum.data?.pay_what_you_want)
      throw new Error("Pay-what-you-want is not enabled for this product");
    const min = Number(minimum.data.minimum_price ?? 0);
    if (!Number.isFinite(payWhatYouWant) || payWhatYouWant < min)
      throw new Error(`Amount must be at least ${min}`);
    final = payWhatYouWant;
  } else if (couponCode) {
    const result = await admin.rpc("validate_coupon", {
      p_code: couponCode,
      p_seller_id: listing.seller_id,
      p_amount: gross,
      p_currency: listing.currency,
      p_buyer_id: buyerId,
    });
    if (result.error) throw new Error(result.error.message);
    const hit = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!hit) throw new Error("Invalid coupon");
    discount = Number(hit.discount_amount || 0);
    couponId = hit.coupon_id;
    final = gross - discount;
  }
  const effectiveGross = payWhatYouWant !== undefined ? Number(final.toFixed(2)) : gross;
  return { gross: effectiveGross, final: Number(final.toFixed(2)), discount, couponId };
}

function getRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Online payments are not configured. Add Razorpay credentials on the server.");
  }
  return { keyId, keySecret };
}

function basicAuth(keyId: string, keySecret: string) {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

function getStripeConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("Stripe payments are not configured on the server.");
  return { secretKey };
}

async function stripeRequest<T>(
  path: string,
  params: Record<string, string> = {},
  method = "POST",
) {
  const { secretKey } = getStripeConfig();
  const body = new URLSearchParams(params);
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : body.toString(),
  });
  const raw = await response.text();
  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) throw new Error(parsed?.error?.message ?? "Stripe request failed");
  return parsed as T;
}

function configuredPaymentProvider(): "stripe" | "razorpay" {
  const forced = String(process.env.PAYMENT_PROVIDER ?? "auto").toLowerCase();
  if (forced === "stripe") return "stripe";
  if (forced === "razorpay") return "razorpay";
  return process.env.STRIPE_SECRET_KEY ? "stripe" : "razorpay";
}

function assertVeloraUSD(currency: unknown) {
  if (String(currency ?? "").toUpperCase() !== "USD") {
    throw new Error(
      "NORDEVA checkout supports USD prices only. This listing needs to be reviewed before it can be sold.",
    );
  }
}

export const getPaymentProvider = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const provider = configuredPaymentProvider();
    if (provider === "stripe" && !process.env.STRIPE_SECRET_KEY)
      throw new Error("Stripe is not configured");
    if (
      provider === "razorpay" &&
      (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
    )
      throw new Error("Razorpay is not configured");
    return { provider };
  });

export const createStripeCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        listing_id: z.string().uuid(),
        variant_id: z.string().uuid().optional(),
        coupon_code: z.string().trim().max(80).optional(),
        pay_what_you_want: z.number().positive().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    if (configuredPaymentProvider() !== "stripe")
      throw new Error("Stripe is not the active payment provider");
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: listing, error } = await supabase
      .from("listings")
      .select("id,title,price,currency,status,seller_id")
      .eq("id", data.listing_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!listing || listing.status !== "active")
      throw new Error("This product is not available for purchase");
    assertVeloraUSD(listing.currency);
    if (listing.seller_id === userId) throw new Error("You cannot purchase your own product");

    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("listing_id", listing.id)
      .eq("buyer_id", userId)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle();
    if (existing) throw new Error("You already own this product");

    let variant: any = null;
    if (data.variant_id) {
      const { data: row, error: variantError } = await supabase
        .from("product_variants")
        .select("id,name,price,currency,active,listing_id")
        .eq("id", data.variant_id)
        .eq("listing_id", listing.id)
        .eq("active", true)
        .maybeSingle();
      if (variantError) throw new Error(variantError.message);
      if (!row) throw new Error("Selected product tier is unavailable");
      if (
        String(row.currency).toUpperCase() !== "USD" ||
        String(listing.currency).toUpperCase() !== "USD"
      )
        throw new Error("NORDEVA product tiers must use USD.");
      variant = row;
    }

    const { data: userData } = await supabase.auth.getUser();
    const buyerEmail = userData.user?.email;
    if (!buyerEmail) throw new Error("A verified email is required for checkout");
    const checkout = await resolveCheckoutPrice(
      supabaseAdmin,
      listing,
      variant,
      userId,
      data.coupon_code,
      data.pay_what_you_want,
    );
    const amount = toMinorUnits(checkout.final, String(listing.currency));
    const currency = String(listing.currency).toLowerCase();
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid product price");
    if (!/^[a-z]{3}$/.test(currency)) throw new Error("Unsupported ISO currency");

    const appUrl = process.env.VITE_APP_URL || "http://localhost:3000";
    const params: Record<string, string> = {
      mode: "payment",
      "line_items[0][price_data][currency]": currency,
      "line_items[0][price_data][product_data][name]": variant
        ? `${listing.title} — ${variant.name}`
        : listing.title,
      "line_items[0][price_data][product_data][description]":
        "Digital product from NORDEVA Marketplace",
      "line_items[0][price_data][unit_amount]": String(amount),
      "line_items[0][quantity]": "1",
      customer_email: buyerEmail,
      success_url: `${appUrl}/purchases?payment=processing&provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/checkout/${listing.id}${variant ? `?variant=${variant.id}&cancelled=1` : `?cancelled=1`}`,
      "metadata[listing_id]": listing.id,
      "metadata[variant_id]": variant?.id ?? "",
      "metadata[buyer_id]": userId,
      "metadata[buyer_email]": buyerEmail,
      "metadata[gross_amount]": String(checkout.gross),
      "metadata[discount_amount]": String(checkout.discount),
      "metadata[coupon_id]": checkout.couponId ?? "",
    };
    if (checkout.couponId) params["metadata[coupon_code]"] = data.coupon_code ?? "";
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
      params["payment_intent_data[application_fee_amount]"] = String(
        Math.round(amount * PLATFORM_FEE_RATE),
      );
      params["payment_intent_data[transfer_data][destination]"] = sellerAccount.provider_account_id;
    }
    const session = await stripeRequest<{ id: string; url: string }>("/checkout/sessions", params);
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return {
      provider: "stripe" as const,
      sessionId: session.id,
      url: session.url,
      amount,
      currency: currency.toUpperCase(),
    };
  });

async function razorpayRequest<T>(path: string, init: RequestInit = {}) {
  const { keyId, keySecret } = getRazorpayConfig();
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: basicAuth(keyId, keySecret),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.text();
  let parsed: any = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new Error(parsed?.error?.description ?? "Payment provider request failed");
  }
  return parsed as T;
}

async function hmacSha256Hex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export const createRazorpayOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        listing_id: z.string().uuid(),
        variant_id: z.string().uuid().optional(),
        coupon_code: z.string().trim().max(80).optional(),
        pay_what_you_want: z.number().positive().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: listing, error } = await supabase
      .from("listings")
      .select("id,title,price,currency,status,seller_id")
      .eq("id", data.listing_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!listing) throw new Error("Product not found");
    assertVeloraUSD(listing.currency);
    if (listing.status !== "active") throw new Error("This product is not available for purchase");
    if (listing.seller_id === userId) throw new Error("You cannot purchase your own product");

    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("listing_id", listing.id)
      .eq("buyer_id", userId)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle();
    if (existing) throw new Error("You already own this product");

    let variant: any = null;
    if (data.variant_id) {
      const { data: variantRow, error: variantError } = await supabase
        .from("product_variants")
        .select("id,name,price,currency,active,listing_id")
        .eq("id", data.variant_id)
        .eq("listing_id", listing.id)
        .eq("active", true)
        .maybeSingle();
      if (variantError) throw new Error(variantError.message);
      if (!variantRow) throw new Error("Selected product tier is unavailable");
      if (String(variantRow.currency).toUpperCase() !== String(listing.currency).toUpperCase())
        throw new Error("Product tier currency mismatch");
      variant = variantRow;
    }

    const { data: userData } = await supabase.auth.getUser();
    const buyerEmail = userData.user?.email;
    if (!buyerEmail) throw new Error("A verified email is required for checkout");

    const checkout = await resolveCheckoutPrice(
      supabaseAdmin,
      listing,
      variant,
      userId,
      data.coupon_code,
      data.pay_what_you_want,
    );
    const amount = toMinorUnits(checkout.final, String(listing.currency));
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid product price");

    const providerOrder = await razorpayRequest<{ id: string; amount: number; currency: string }>(
      "/orders",
      {
        method: "POST",
        body: JSON.stringify({
          amount,
          currency: String(listing.currency).toUpperCase(),
          receipt: `velora_${listing.id.slice(0, 8)}_${userId.slice(0, 8)}_${Date.now()}`.slice(
            0,
            40,
          ),
          notes: {
            listing_id: listing.id,
            variant_id: variant?.id ?? null,
            buyer_id: userId,
            buyer_email: buyerEmail,
            gross_amount: checkout.gross,
            discount_amount: checkout.discount,
            coupon_id: checkout.couponId ?? "",
            pay_what_you_want: data.pay_what_you_want ?? "",
          },
        }),
      },
    );

    return {
      keyId: getRazorpayConfig().keyId,
      orderId: providerOrder.id,
      amount: providerOrder.amount,
      currency: providerOrder.currency,
      name: "NORDEVA Marketplace",
      description: variant ? `${listing.title} — ${variant.name}` : listing.title,
      email: buyerEmail,
    };
  });

export const verifyRazorpayPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        listing_id: z.string().uuid(),
        variant_id: z.string().uuid().optional(),
        razorpay_order_id: z.string().min(1).max(100),
        razorpay_payment_id: z.string().min(1).max(100),
        razorpay_signature: z.string().min(1).max(200),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { keySecret } = getRazorpayConfig();
    const expected = await hmacSha256Hex(
      keySecret,
      `${data.razorpay_order_id}|${data.razorpay_payment_id}`,
    );
    if (!timingSafeEqual(expected, data.razorpay_signature)) {
      throw new Error("Payment verification failed");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: listing, error: listingError } = await supabaseAdmin
      .from("listings")
      .select("id,title,price,currency,status,seller_id")
      .eq("id", data.listing_id)
      .maybeSingle();
    if (listingError) throw new Error(listingError.message);
    if (!listing || listing.status !== "active") throw new Error("Product is no longer available");
    assertVeloraUSD(listing.currency);
    if (listing.seller_id === context.userId)
      throw new Error("You cannot purchase your own product");

    let variant: any = null;
    if (data.variant_id) {
      const { data: variantRow, error: variantError } = await supabaseAdmin
        .from("product_variants")
        .select("id,name,price,currency,active,listing_id")
        .eq("id", data.variant_id)
        .eq("listing_id", listing.id)
        .eq("active", true)
        .maybeSingle();
      if (variantError) throw new Error(variantError.message);
      if (!variantRow) throw new Error("Selected product tier is unavailable");
      variant = variantRow;
    }

    let payment = await razorpayRequest<{
      id: string;
      order_id: string;
      amount: number;
      currency: string;
      status: string;
    }>(`/payments/${encodeURIComponent(data.razorpay_payment_id)}`);
    const providerOrder = await razorpayRequest<any>(
      `/orders/${encodeURIComponent(data.razorpay_order_id)}`,
    );
    const checkoutGross = Number(
      providerOrder?.notes?.gross_amount ||
        (variant ? Number(variant.price) : Number(listing.price)),
    );
    const checkoutDiscount = Number(providerOrder?.notes?.discount_amount || 0);
    const expectedAmount = toMinorUnits(
      Math.max(0, checkoutGross - checkoutDiscount),
      String(listing.currency),
    );
    if (payment.status === "authorized") {
      payment = await razorpayRequest<{
        id: string;
        order_id: string;
        amount: number;
        currency: string;
        status: string;
      }>(`/payments/${encodeURIComponent(data.razorpay_payment_id)}/capture`, {
        method: "POST",
        body: JSON.stringify({
          amount: expectedAmount,
          currency: String(listing.currency).toUpperCase(),
        }),
      });
    }
    if (
      payment.order_id !== data.razorpay_order_id ||
      payment.id !== data.razorpay_payment_id ||
      payment.amount !== expectedAmount ||
      payment.currency !== String(listing.currency).toUpperCase() ||
      payment.status !== "captured"
    ) {
      throw new Error("Payment could not be verified as captured");
    }

    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const buyerEmail = userData.user?.email;
    if (!buyerEmail) throw new Error("Buyer email is missing");

    const { data: existing } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("provider_payment_id", data.razorpay_payment_id)
      .maybeSingle();
    if (existing) return { ok: true as const, orderId: existing.id, alreadyProcessed: true };

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .insert({
        listing_id: listing.id,
        variant_id: variant?.id ?? null,
        buyer_id: context.userId,
        buyer_email: buyerEmail,
        provider: "razorpay",
        provider_order_id: data.razorpay_order_id,
        provider_payment_id: data.razorpay_payment_id,
        paid_at: new Date().toISOString(),
        payment_status: "captured",
        gross_amount: checkoutGross,
        discount_amount: checkoutDiscount,
        coupon_id: providerOrder?.notes?.coupon_id || null,
      } as any)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (providerOrder?.notes?.coupon_id)
      await supabaseAdmin.rpc("consume_coupon", {
        p_coupon_id: providerOrder.notes.coupon_id,
        p_buyer_id: context.userId,
        p_order_id: order.id,
        p_amount: checkoutDiscount,
      });
    await issueLicenseIfNeeded(supabaseAdmin, order.id, listing.id, context.userId);

    return { ok: true as const, orderId: order.id, alreadyProcessed: false };
  });

export async function verifyRazorpayWebhookSignature(rawBody: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET is not configured");
  const expected = await hmacSha256Hex(secret, rawBody);
  return timingSafeEqual(expected, signature);
}

export async function handleRazorpayWebhook(payload: any) {
  const event = String(payload?.event ?? "");
  const payment = payload?.payload?.payment?.entity;
  if (!payment?.id || !payment?.order_id) return { ignored: true as const };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: duplicate } = await supabaseAdmin
    .from("payment_events")
    .select("id")
    .eq(
      "provider_event_id",
      String(payload?.account_id ?? "") + ":" + String(payment.id) + ":" + event,
    )
    .maybeSingle();
  if (duplicate) return { ignored: true as const, duplicate: true as const };

  await supabaseAdmin.from("payment_events").insert({
    provider: "razorpay",
    provider_event_id: String(payload?.account_id ?? "") + ":" + String(payment.id) + ":" + event,
    event_type: event,
    payload,
  });

  if (event !== "payment.captured" && event !== "order.paid") return { ignored: true as const };

  const providerOrder = await razorpayRequest<any>(
    `/orders/${encodeURIComponent(payment.order_id)}`,
  );
  const notes = providerOrder?.notes ?? {};
  const listingId = notes.listing_id;
  const buyerId = notes.buyer_id;
  const variantId = notes.variant_id || undefined;
  if (!listingId || !buyerId) throw new Error("Razorpay order is missing NORDEVA metadata");

  const { data: listing, error: listingError } = await supabaseAdmin
    .from("listings")
    .select("id,price,currency,status,seller_id")
    .eq("id", listingId)
    .maybeSingle();
  if (listingError) throw new Error(listingError.message);
  if (!listing || listing.status !== "active") throw new Error("Listing unavailable");
  assertVeloraUSD(listing.currency);
  let variant: any = null;
  if (variantId) {
    const { data: variantRow, error: variantError } = await supabaseAdmin
      .from("product_variants")
      .select("id,price,currency,active,listing_id")
      .eq("id", variantId)
      .eq("listing_id", listing.id)
      .eq("active", true)
      .maybeSingle();
    if (variantError) throw new Error(variantError.message);
    if (!variantRow) throw new Error("Variant unavailable");
    variant = variantRow;
  }
  const checkoutGross = Number(
    providerOrder?.notes?.gross_amount || (variant ? Number(variant.price) : Number(listing.price)),
  );
  const checkoutDiscount = Number(providerOrder?.notes?.discount_amount || 0);
  const expectedWebhookAmount = toMinorUnits(
    Math.max(0, checkoutGross - checkoutDiscount),
    String(listing.currency),
  );
  if (
    payment.amount !== expectedWebhookAmount ||
    payment.currency !== String(listing.currency).toUpperCase()
  ) {
    throw new Error("Payment amount/currency mismatch");
  }

  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(buyerId);
  if (!userData.user?.email) throw new Error("Buyer account email missing");

  const { data: existing } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("provider_payment_id", payment.id)
    .maybeSingle();
  if (existing) return { ok: true as const, orderId: existing.id, alreadyProcessed: true };

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .insert({
      listing_id: listing.id,
      variant_id: variant?.id ?? null,
      buyer_id: buyerId,
      buyer_email: userData.user.email,
      provider: "razorpay",
      provider_order_id: payment.order_id,
      provider_payment_id: payment.id,
      paid_at: new Date().toISOString(),
      payment_status: "captured",
      gross_amount: checkoutGross,
      discount_amount: checkoutDiscount,
      coupon_id: providerOrder?.notes?.coupon_id || null,
    } as any)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (providerOrder?.notes?.coupon_id)
    await supabaseAdmin.rpc("consume_coupon", {
      p_coupon_id: providerOrder.notes.coupon_id,
      p_buyer_id: buyerId,
      p_order_id: order.id,
      p_amount: checkoutDiscount,
    });
  await issueLicenseIfNeeded(supabaseAdmin, order.id, listing.id, buyerId);
  return { ok: true as const, orderId: order.id };
}

export async function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  const parts = signatureHeader.split(",");
  const timestamp = parts.find((x) => x.startsWith("t="))?.slice(2);
  const signatures = parts.filter((x) => x.startsWith("v1=")).map((x) => x.slice(3));
  if (!timestamp || !signatures.length) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return signatures.some((signature) => timingSafeEqual(expected, signature));
}

async function createVerifiedStripeOrder(session: any) {
  const listingId = session?.metadata?.listing_id;
  const variantId = session?.metadata?.variant_id || undefined;
  const buyerId = session?.metadata?.buyer_id;
  const buyerEmail =
    session?.customer_details?.email || session?.customer_email || session?.metadata?.buyer_email;
  const paymentId =
    typeof session?.payment_intent === "string"
      ? session.payment_intent
      : session?.payment_intent?.id;
  if (!listingId || !buyerId || !buyerEmail || !paymentId)
    throw new Error("Stripe session is missing required NORDEVA metadata");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: listing, error: listingError } = await supabaseAdmin
    .from("listings")
    .select("id,price,currency,status,seller_id")
    .eq("id", listingId)
    .maybeSingle();
  if (listingError) throw new Error(listingError.message);
  if (!listing || listing.status !== "active") throw new Error("Listing unavailable");
  assertVeloraUSD(listing.currency);
  if (listing.seller_id === buyerId) throw new Error("Seller cannot purchase their own product");

  let variant: any = null;
  if (variantId) {
    const { data: row, error } = await supabaseAdmin
      .from("product_variants")
      .select("id,price,currency,active,listing_id")
      .eq("id", variantId)
      .eq("listing_id", listing.id)
      .eq("active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Variant unavailable");
    if (
      String(row.currency).toUpperCase() !== "USD" ||
      String(listing.currency).toUpperCase() !== "USD"
    )
      throw new Error("NORDEVA product tiers must use USD.");
    variant = row;
  }
  const expectedAmount = toMinorUnits(
    Number(session?.metadata?.gross_amount ?? variant?.price ?? listing.price) -
      Number(session?.metadata?.discount_amount ?? 0),
    String(listing.currency),
  );
  const sessionAmount = Number(session.amount_total ?? 0);
  if (
    sessionAmount !== expectedAmount ||
    String(session.currency).toUpperCase() !== String(listing.currency).toUpperCase()
  ) {
    throw new Error("Stripe payment amount/currency mismatch");
  }

  const { data: existing } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("provider_payment_id", paymentId)
    .maybeSingle();
  if (existing) return { ok: true as const, orderId: existing.id, alreadyProcessed: true };

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .insert({
      listing_id: listing.id,
      variant_id: variant?.id ?? null,
      buyer_id: buyerId,
      buyer_email: buyerEmail,
      provider: "stripe",
      provider_order_id: session.id,
      provider_payment_id: paymentId,
      paid_at: new Date().toISOString(),
      payment_status: "captured",
      gross_amount: Number(session?.metadata?.gross_amount ?? variant?.price ?? listing.price),
      discount_amount: Number(session?.metadata?.discount_amount ?? 0),
      coupon_id: session?.metadata?.coupon_id || null,
      provider_checkout_id: session.id,
    } as any)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (session?.metadata?.coupon_id)
    await supabaseAdmin.rpc("consume_coupon", {
      p_coupon_id: session.metadata.coupon_id,
      p_buyer_id: buyerId,
      p_order_id: order.id,
      p_amount: Number(session?.metadata?.discount_amount ?? 0),
    });
  await issueLicenseIfNeeded(supabaseAdmin, order.id, listing.id, buyerId);
  return { ok: true as const, orderId: order.id, alreadyProcessed: false };
}

async function createVerifiedStripeSubscription(session: any) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const listingId = session?.metadata?.listing_id;
  const buyerId = session?.metadata?.buyer_id;
  const variantId = session?.metadata?.variant_id || null;
  if (!listingId || !buyerId || !session?.subscription)
    throw new Error("Stripe subscription session is missing NORDEVA metadata");
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const { data: listing, error } = await supabaseAdmin
    .from("listings")
    .select("id,price,currency,status,seller_id")
    .eq("id", listingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!listing || listing.status !== "active") throw new Error("Listing unavailable");
  const { data: existing } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("provider_subscription_id", subscriptionId)
    .maybeSingle();
  if (existing) return { ok: true as const, subscriptionId, alreadyProcessed: true };
  const amount = Number(session.amount_total || 0) / 100;
  const { error: insertError } = await supabaseAdmin.from("subscriptions").insert({
    user_id: buyerId,
    listing_id: listingId,
    variant_id: variantId,
    provider: "stripe",
    provider_subscription_id: subscriptionId,
    status: "active",
    currency: String(session.currency || listing.currency).toUpperCase(),
    amount,
    interval: "month",
    current_period_end: null,
  });
  if (insertError) throw new Error(insertError.message);
  return { ok: true as const, subscriptionId, alreadyProcessed: false };
}

export async function handleStripeWebhook(payload: any) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const event = String(payload?.type ?? "");
  if (event === "checkout.session.completed") {
    const session = payload?.data?.object;
    if (session?.metadata?.kind === "project_payment") {
      const { handleProjectPaymentCompleted } = await import("@/lib/project-payment.functions");
      return handleProjectPaymentCompleted(session, payload);
    }
    if (session?.mode === "subscription") return createVerifiedStripeSubscription(session);
    if (session?.payment_status !== "paid") return { ignored: true as const };
    return createVerifiedStripeOrder(session);
  }
  if (event === "customer.subscription.updated" || event === "customer.subscription.deleted") {
    const sub = payload?.data?.object;
    const providerId = sub?.id;
    if (!providerId) return { ignored: true as const };
    const status = event.endsWith("deleted")
      ? "cancelled"
      : sub.status === "active"
        ? "active"
        : sub.status === "past_due"
          ? "past_due"
          : sub.status === "paused"
            ? "paused"
            : sub.status === "incomplete"
              ? "incomplete"
              : "expired";
    await supabaseAdmin
      .from("subscriptions")
      .update({
        status,
        cancel_at_period_end: Boolean(sub.cancel_at_period_end),
        cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
        latest_invoice_id: typeof sub.latest_invoice === "string" ? sub.latest_invoice : null,
      })
      .eq("provider_subscription_id", providerId);
    return { ok: true as const };
  }
  if (event === "charge.refunded") {
    const charge = payload?.data?.object;
    const paymentIntent =
      typeof charge?.payment_intent === "string"
        ? charge.payment_intent
        : charge?.payment_intent?.id;
    if (!paymentIntent) return { ignored: true as const };
    await supabaseAdmin
      .from("orders")
      .update({ payment_status: "refunded", status: "refunded" })
      .eq("provider", "stripe")
      .eq("provider_payment_id", paymentIntent);
    // If the refunded charge belongs to a project payment, mirror it there.
    const { handleProjectChargeRefunded } = await import("@/lib/project-payment.functions");
    await handleProjectChargeRefunded(charge, payload);
    return { ok: true as const };
  }
  if (event === "charge.dispute.created") {
    const dispute = payload?.data?.object;
    const paymentIntent =
      typeof dispute?.payment_intent === "string"
        ? dispute.payment_intent
        : dispute?.payment_intent?.id;
    if (!paymentIntent) return { ignored: true as const };
    await supabaseAdmin
      .from("orders")
      .update({ payment_status: "disputed", status: "disputed" })
      .eq("provider", "stripe")
      .eq("provider_payment_id", paymentIntent);
    // If the disputed charge belongs to a project payment, mirror it there.
    const { handleProjectDisputeCreated } = await import("@/lib/project-payment.functions");
    await handleProjectDisputeCreated(dispute, payload);
    return { ok: true as const };
  }
  if (event === "payment_intent.payment_failed") {
    // Failed PaymentIntents normally have no completed order. Keep the event
    // acknowledged so the webhook does not retry forever.
    return { ok: true as const, paymentFailed: true as const };
  }
  return { ignored: true as const };
}
