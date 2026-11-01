import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toMinorUnits } from "@/lib/currencies";

/**
 * Wave F — project payments for custom website projects.
 *
 * Mirrors the product checkout patterns in payment.functions.ts (raw Stripe
 * REST calls, lazy supabaseAdmin import, server-side verification in the
 * webhook), with three project-specific rules:
 *   - The amount is never chosen by the payer's browser: it is the
 *     website_requests.agreed_amount recorded when the client accepted the
 *     developer's proposal terms.
 *   - The 85/15 split is computed here and stored on the project_payments
 *     row (developer_amount = 85% rounded to 2dp; platform_fee = remainder,
 *     so the two always sum back to the charged amount).
 *   - Nothing is ever simulated: without STRIPE_SECRET_KEY the checkout
 *     fails loudly with "Stripe is not configured for project payments yet"
 *     and the workspace shows that honestly.
 */

const PLATFORM_FEE_RATE = 0.15;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function projectFeeBreakdown(amount: number) {
  const developerAmount = round2(amount * (1 - PLATFORM_FEE_RATE));
  const platformFee = round2(amount - developerAmount);
  return { platformFee, developerAmount };
}

function stripeSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY || null;
}

export function stripeTestMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}

async function stripeRequest<T>(
  path: string,
  params: Record<string, string> = {},
  method = "POST",
) {
  const secretKey = stripeSecretKey();
  if (!secretKey) throw new Error("Stripe is not configured for project payments yet");
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

function isMissingPaymentsTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return (error.message ?? "").includes("project_payments");
}

const requestIdInput = (data: unknown) => z.object({ request_id: z.string().uuid() }).parse(data);

/* ------------------------------------------------------------------ */
/* Checkout creation (client pays the agreed project amount)           */
/* ------------------------------------------------------------------ */

export const createProjectCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(requestIdInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: request, error } = await supabaseAdmin
      .from("website_requests")
      .select(
        "id,title,requester_id,taken_by,agreed_amount,agreed_currency,currency,project_status",
      )
      .eq("id", data.request_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!request) throw new Error("Project not found");
    if (request.requester_id !== userId)
      throw new Error("Only the client who posted this project can pay for it");

    // Suspension enforcement (M5): admin_user_controls has always recorded
    // account states, and checkout is where that record becomes binding.
    // This fails closed on purpose — a standing read error stops the
    // payment rather than silently letting it through.
    const { data: controls, error: controlsError } = await supabaseAdmin
      .from("admin_user_controls")
      .select("state")
      .eq("user_id", userId)
      .maybeSingle();
    if (controlsError) throw new Error(controlsError.message);
    if (controls?.state === "suspended" || controls?.state === "banned")
      throw new Error(
        "Your account is suspended — payments are paused. Contact support if you believe this is a mistake.",
      );
    if (!request.taken_by)
      throw new Error("A developer must be selected before the project can be paid for");
    const agreedAmount = Number(request.agreed_amount ?? NaN);
    if (!Number.isFinite(agreedAmount) || agreedAmount <= 0)
      throw new Error("The project amount has not been agreed yet");
    const projectStatus = String(request.project_status ?? "");
    if (projectStatus !== "awaiting_payment" && projectStatus !== "awaiting_agreement")
      throw new Error("This project is not waiting for payment");

    if (!stripeSecretKey()) throw new Error("Stripe is not configured for project payments yet");

    const currency = String(request.agreed_currency || request.currency || "USD").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Unsupported project currency");
    const { platformFee, developerAmount } = projectFeeBreakdown(agreedAmount);

    // Idempotency: reuse the latest still-open checkout session created in
    // the last 24 hours instead of stacking duplicate sessions/rows. The
    // session is re-fetched from Stripe — a row alone is never trusted.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: pending, error: pendingError } = await supabaseAdmin
      .from("project_payments")
      .select("id,provider_session_id")
      .eq("request_id", request.id)
      .eq("status", "pending")
      .not("provider_session_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pendingError) {
      if (isMissingPaymentsTable(pendingError))
        throw new Error(
          "Project payments activate once the database upgrade is applied to the live project",
        );
      throw new Error(pendingError.message);
    }
    if (pending?.provider_session_id) {
      let existing: { id: string; url: string | null; status: string } | null = null;
      try {
        existing = await stripeRequest<{ id: string; url: string | null; status: string }>(
          `/checkout/sessions/${encodeURIComponent(pending.provider_session_id)}`,
          {},
          "GET",
        );
      } catch {
        existing = null; // retrieval failed — fall through to a fresh session
      }
      if (existing?.status === "open" && existing.url) {
        return {
          provider: "stripe" as const,
          sessionId: existing.id,
          url: existing.url,
          reused: true as const,
        };
      }
      if (existing?.status === "complete")
        throw new Error("This project has already been paid — refresh the workspace");
      if (existing?.status === "expired") {
        await supabaseAdmin
          .from("project_payments")
          .update({ status: "failed" })
          .eq("id", pending.id)
          .eq("status", "pending");
      }
    }

    const amountMinor = toMinorUnits(agreedAmount, currency);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0)
      throw new Error("Invalid project amount");

    const { data: userData } = await supabase.auth.getUser();
    const payerEmail = userData.user?.email;
    const appUrl = process.env.VITE_APP_URL || "http://localhost:3000";
    const title = String(request.title ?? "Custom website project").slice(0, 120);
    const params: Record<string, string> = {
      mode: "payment",
      "line_items[0][price_data][currency]": currency.toLowerCase(),
      "line_items[0][price_data][product_data][name]": `NORDEVA project — ${title}`,
      "line_items[0][price_data][product_data][description]":
        "Custom website project payment via NORDEVA — 85% goes to the developer, 15% is the NORDEVA fee.",
      "line_items[0][price_data][unit_amount]": String(amountMinor),
      "line_items[0][quantity]": "1",
      success_url: `${appUrl}/projects/${request.id}?payment=processing&provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/projects/${request.id}?payment=cancelled`,
      "metadata[kind]": "project_payment",
      "metadata[request_id]": request.id,
      "metadata[payer_id]": userId,
      "metadata[payee_id]": request.taken_by,
      "payment_intent_data[metadata][kind]": "project_payment",
      "payment_intent_data[metadata][request_id]": request.id,
    };
    if (payerEmail) params.customer_email = payerEmail;

    const session = await stripeRequest<{ id: string; url: string }>("/checkout/sessions", params);
    if (!session.url) throw new Error("Stripe did not return a checkout URL");

    const { error: insertError } = await supabaseAdmin.from("project_payments").insert({
      request_id: request.id,
      payer_id: userId,
      payee_id: request.taken_by,
      provider: "stripe",
      provider_session_id: session.id,
      amount: agreedAmount,
      currency,
      platform_fee: platformFee,
      developer_amount: developerAmount,
      status: "pending",
    });
    if (insertError) throw new Error(insertError.message);

    return {
      provider: "stripe" as const,
      sessionId: session.id,
      url: session.url,
      reused: false as const,
    };
  });

/* ------------------------------------------------------------------ */
/* Read model for the workspace payment card                           */
/* ------------------------------------------------------------------ */

export const getProjectPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(requestIdInput)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: request, error } = await supabaseAdmin
      .from("website_requests")
      .select("id,requester_id,taken_by,agreed_amount,agreed_currency,currency")
      .eq("id", data.request_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!request) throw new Error("Project not found");

    let allowed = request.requester_id === userId || request.taken_by === userId;
    if (!allowed) {
      const { data: role } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      allowed = !!role;
    }
    if (!allowed) throw new Error("Only the project participants can view its payment details");

    const agreedAmount = request.agreed_amount != null ? Number(request.agreed_amount) : null;
    const currency = String(request.agreed_currency || request.currency || "USD").toUpperCase();
    const breakdown =
      agreedAmount != null && Number.isFinite(agreedAmount) && agreedAmount > 0
        ? { amount: agreedAmount, currency, ...projectFeeBreakdown(agreedAmount) }
        : null;

    let payment = null;
    let unavailable = false;
    const { data: rows, error: paymentError } = await supabaseAdmin
      .from("project_payments")
      .select("*")
      .eq("request_id", request.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (paymentError) {
      if (isMissingPaymentsTable(paymentError)) unavailable = true;
      else throw new Error(paymentError.message);
    } else {
      payment = rows?.[0] ?? null;
    }

    return {
      payment,
      breakdown,
      stripeConfigured: !!stripeSecretKey(),
      testMode: stripeTestMode(),
      unavailable,
    };
  });

/* ------------------------------------------------------------------ */
/* Webhook helpers (called from handleStripeWebhook)                   */
/*                                                                     */
/* These run under the service role, where auth.uid() is NULL, so the  */
/* transition_project_status RPC cannot be used — project columns are  */
/* updated directly, exactly how the same webhook updates orders. The  */
/* legacy `status` column is kept in sync with the RPC's own mapping.  */
/* ------------------------------------------------------------------ */

async function recordProjectPaymentEvent(admin: any, payload: any) {
  const eventId = String(payload?.id ?? "");
  if (!eventId) return;
  const { data: existing } = await admin
    .from("payment_events")
    .select("id")
    .eq("provider", "stripe")
    .eq("provider_event_id", eventId)
    .maybeSingle();
  if (existing) return;
  await admin.from("payment_events").insert({
    provider: "stripe",
    provider_event_id: eventId,
    event_type: String(payload?.type ?? "unknown"),
    payload,
  });
}

export async function handleProjectPaymentCompleted(session: any, payload: any) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;
  const requestId = session?.metadata?.request_id;
  const paymentIntent =
    typeof session?.payment_intent === "string"
      ? session.payment_intent
      : session?.payment_intent?.id;
  if (!requestId || !paymentIntent)
    throw new Error("Stripe project payment session is missing NORDEVA metadata");
  if (session?.payment_status !== "paid") return { ignored: true as const };

  let { data: row } = await admin
    .from("project_payments")
    .select("*")
    .eq("provider_session_id", session.id)
    .maybeSingle();
  if (!row) {
    const { data: pendingRows } = await admin
      .from("project_payments")
      .select("*")
      .eq("request_id", requestId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1);
    row = pendingRows?.[0] ?? null;
  }
  if (row?.status === "paid") return { ok: true as const, alreadyProcessed: true as const };

  const { data: request } = await admin
    .from("website_requests")
    .select("id,title,requester_id,taken_by,project_status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) throw new Error("Project not found for the Stripe payment");

  // Verify the money matches the recorded agreement before trusting it —
  // the same amount/currency check the product order flow performs.
  const sessionAmount = Number(session.amount_total ?? NaN);
  const sessionCurrency = String(session.currency ?? "").toUpperCase();
  if (!Number.isFinite(sessionAmount) || sessionAmount <= 0)
    throw new Error("Stripe project payment amount is invalid");
  let amount: number;
  let currency: string;
  let platformFee: number;
  let developerAmount: number;
  if (row) {
    const expected = toMinorUnits(Number(row.amount), String(row.currency));
    if (sessionAmount !== expected || sessionCurrency !== String(row.currency).toUpperCase())
      throw new Error("Stripe project payment amount/currency mismatch");
    amount = Number(row.amount);
    currency = String(row.currency).toUpperCase();
    platformFee = Number(row.platform_fee);
    developerAmount = Number(row.developer_amount);
  } else {
    // The checkout was created but its row insert failed earlier — rebuild
    // the record from the verified session so the payment is never lost.
    amount = sessionAmount / 100;
    currency = sessionCurrency;
    ({ platformFee, developerAmount } = projectFeeBreakdown(amount));
  }

  if (row) {
    await admin
      .from("project_payments")
      .update({ status: "paid", provider_payment_intent: paymentIntent })
      .eq("id", row.id);
  } else {
    const payerId = session?.metadata?.payer_id || request.requester_id;
    const payeeId = session?.metadata?.payee_id || request.taken_by;
    if (!payerId || !payeeId) throw new Error("Project payment participants are missing");
    await admin.from("project_payments").insert({
      request_id: requestId,
      payer_id: payerId,
      payee_id: payeeId,
      provider: "stripe",
      provider_session_id: session.id,
      provider_payment_intent: paymentIntent,
      amount,
      currency,
      platform_fee: platformFee,
      developer_amount: developerAmount,
      status: "paid",
    });
  }

  await recordProjectPaymentEvent(admin, payload);

  // Payment-confirmed notifications (Wave M6). This point is only reached
  // on the pass that actually transitions the row to "paid" — duplicate
  // webhook deliveries return earlier via the alreadyProcessed guard —
  // so each party is notified exactly once. Notification failures must
  // never fail the webhook, hence the swallowed catch.
  try {
    const projectTitle = String(request.title ?? "your website project");
    const href = `/projects/${requestId}`;
    const notes: { user_id: string; title: string; body: string; href: string }[] = [];
    if (request.requester_id) {
      notes.push({
        user_id: request.requester_id,
        title: "Payment confirmed",
        body: `Payment confirmed for "${projectTitle}".`,
        href,
      });
    }
    if (request.taken_by) {
      notes.push({
        user_id: request.taken_by,
        title: "Payment received",
        body: `Payment received — ${currency} ${amount.toFixed(2)} for "${projectTitle}"; your share is recorded.`,
        href,
      });
    }
    if (notes.length > 0) await admin.from("notifications").insert(notes);
  } catch {
    /* notifications are best-effort; the payment record is the source of truth */
  }

  if (request.project_status === "awaiting_payment") {
    await admin
      .from("website_requests")
      .update({
        project_status: "in_progress",
        status: "taken",
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId);
  }
  return { ok: true as const, projectPayment: true as const };
}

async function findProjectPaymentByIntent(admin: any, paymentIntent: string) {
  const { data: row } = await admin
    .from("project_payments")
    .select("*")
    .eq("provider_payment_intent", paymentIntent)
    .maybeSingle();
  return row ?? null;
}

export async function handleProjectChargeRefunded(charge: any, payload: any) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;
  const paymentIntent =
    typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id;
  if (!paymentIntent) return { ignored: true as const };
  const row = await findProjectPaymentByIntent(admin, paymentIntent);
  if (!row) return { ignored: true as const };

  const chargeAmount = Number(charge?.amount ?? 0);
  const refundedAmount = Number(charge?.amount_refunded ?? 0);
  const fullyRefunded = chargeAmount > 0 && refundedAmount >= chargeAmount;
  const nextStatus = fullyRefunded ? "refunded" : "partially_refunded";
  if (row.status === "refunded" || row.status === nextStatus)
    return { ok: true as const, alreadyProcessed: true as const };

  await admin.from("project_payments").update({ status: nextStatus }).eq("id", row.id);
  await recordProjectPaymentEvent(admin, payload);
  if (nextStatus === "refunded") {
    await admin
      .from("website_requests")
      .update({ project_status: "refunded", updated_at: new Date().toISOString() })
      .eq("id", row.request_id);
  }
  return { ok: true as const, projectPayment: true as const };
}

export async function handleProjectDisputeCreated(dispute: any, payload: any) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;
  const paymentIntent =
    typeof dispute?.payment_intent === "string"
      ? dispute.payment_intent
      : dispute?.payment_intent?.id;
  if (!paymentIntent) return { ignored: true as const };
  const row = await findProjectPaymentByIntent(admin, paymentIntent);
  if (!row) return { ignored: true as const };
  if (row.status === "disputed") return { ok: true as const, alreadyProcessed: true as const };

  await admin.from("project_payments").update({ status: "disputed" }).eq("id", row.id);
  await recordProjectPaymentEvent(admin, payload);
  await admin
    .from("website_requests")
    .update({ project_status: "disputed", updated_at: new Date().toISOString() })
    .eq("id", row.request_id);
  return { ok: true as const, projectPayment: true as const };
}
