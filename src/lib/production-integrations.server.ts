import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function basicAuth(id: string, secret: string) {
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok)
    throw new Error(
      body?.error?.description ?? body?.message ?? `Provider request failed (${response.status})`,
    );
  return body;
}

export async function createRazorpayXVendorPayout(input: {
  amount: number;
  currency: string;
  fundAccountId: string;
  referenceId: string;
  mode: "UPI" | "IMPS";
}) {
  const keyId = process.env.RAZORPAYX_KEY_ID;
  const keySecret = process.env.RAZORPAYX_KEY_SECRET;
  const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER;
  if (!keyId || !keySecret || !accountNumber)
    throw new Error("RazorpayX payout automation is not configured");
  if (input.currency.toUpperCase() !== "INR")
    throw new Error("RazorpayX payout automation currently supports INR only");
  const amount = Math.round(input.amount * 100);
  if (amount < 100) throw new Error("Payout amount must be at least ₹1");
  return requestJson("https://api.razorpay.com/v1/payouts", {
    method: "POST",
    headers: {
      Authorization: basicAuth(keyId, keySecret),
      "Content-Type": "application/json",
      "X-Payout-Idempotency": input.referenceId,
    },
    body: JSON.stringify({
      account_number: accountNumber,
      fund_account_id: input.fundAccountId,
      amount,
      currency: "INR",
      mode: input.mode,
      purpose: "payout",
      reference_id: input.referenceId.slice(0, 40),
      narration: "NORDEVA seller payout",
      queue_if_low_balance: true,
    }),
  });
}

export async function createRazorpayRefund(paymentId: string, amount?: number) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Razorpay is not configured");
  const payload = amount && amount > 0 ? { amount: Math.round(amount * 100) } : {};
  return requestJson(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`,
    {
      method: "POST",
      headers: { Authorization: basicAuth(keyId, keySecret), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function createStripeRefund(paymentIntentId: string, amount?: number) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("Stripe is not configured");
  const params = new URLSearchParams();
  params.set("payment_intent", paymentIntentId);
  if (amount && amount > 0) params.set("amount", String(Math.round(amount * 100)));
  const response = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const raw = await response.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!response.ok)
    throw new Error(body?.error?.message ?? `Stripe refund failed (${response.status})`);
  return body;
}

export const adminExecuteRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ refund_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Admin access required");
    const { data: refund, error } = await supabaseAdmin
      .from("refund_requests")
      .select("id,order_id,status")
      .eq("id", data.refund_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!refund) throw new Error("Refund request not found");
    if (!["approved", "under_review"].includes(refund.status))
      throw new Error("Refund must be approved or under review before provider execution");
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id,provider,provider_payment_id,amount,currency")
      .eq("id", refund.order_id)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order?.provider_payment_id) throw new Error("Order has no provider payment ID");
    const providerRefund =
      order.provider === "stripe"
        ? await createStripeRefund(order.provider_payment_id, Number(order.amount))
        : await createRazorpayRefund(order.provider_payment_id, Number(order.amount));
    const { error: updateError } = await supabaseAdmin
      .from("refund_requests")
      .update({
        status: "resolved",
        admin_note: `${String(order.provider).toUpperCase()} refund ${providerRefund?.id ?? "submitted"}`,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", refund.id);
    if (updateError) throw new Error(updateError.message);
    return {
      ok: true as const,
      providerRefundId: providerRefund?.id ?? null,
      provider: order.provider,
    };
  });

export const adminExecutePayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ payout_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Admin access required");
    const { data: payout, error } = await supabaseAdmin
      .from("payout_requests")
      .select("id,user_id,amount,currency,status,method_id")
      .eq("id", data.payout_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!payout || payout.status !== "pending" || !payout.method_id)
      throw new Error("Payout is not pending");
    const { data: method, error: methodError } = await supabaseAdmin
      .from("payout_methods")
      .select("provider_fund_account_id,method_type")
      .eq("id", payout.method_id)
      .eq("user_id", payout.user_id)
      .maybeSingle();
    if (methodError) throw new Error(methodError.message);
    if (!method?.provider_fund_account_id)
      throw new Error("This payout method is not linked to a RazorpayX fund account");
    const provider = await createRazorpayXVendorPayout({
      amount: Number(payout.amount),
      currency: String(payout.currency),
      fundAccountId: method.provider_fund_account_id,
      referenceId: `velora_${payout.id.replaceAll("-", "").slice(0, 30)}`,
      mode: method.method_type === "upi" ? "UPI" : "IMPS",
    });
    const providerId = provider?.id ?? provider?.payout?.id ?? null;
    const { error: updateError } = await supabaseAdmin
      .from("payout_requests")
      .update({
        status: provider?.status === "processed" ? "paid" : "pending",
        provider_reference: providerId,
        admin_note: `RazorpayX payout ${providerId ?? "submitted"}`,
      })
      .eq("id", payout.id)
      .eq("status", "pending");
    if (updateError) throw new Error(updateError.message);
    return { ok: true as const, providerId, status: provider?.status ?? "queued" };
  });
