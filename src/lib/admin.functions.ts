import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const listingDecision = z.object({
  listing_id: z.string().uuid(),
  status: z.enum(["active", "rejected"]),
  review_note: z.string().trim().max(200).optional(),
});

async function requireAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const adminDb = supabaseAdmin as any;
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Admin access required");
  return adminDb;
}

async function audit(
  admin: any,
  userId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await admin.rpc("write_admin_audit", {
    p_admin_id: userId,
    p_action: action,
    p_target_type: targetType,
    p_target_id: targetId,
    p_metadata: metadata,
  });
  if (error) throw new Error(error.message);
}

export const moderateListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => listingDecision.parse(data))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context.userId);
    const { error } = await admin
      .from("listings")
      .update({ status: data.status, review_note: data.review_note?.trim() || null })
      .eq("id", data.listing_id);
    if (error) throw new Error(error.message);
    await admin.from("listing_moderation_events").insert({
      listing_id: data.listing_id,
      admin_id: context.userId,
      action: data.status === "active" ? "approved" : "rejected",
      note: data.review_note?.trim() || null,
    });
    await audit(
      admin,
      context.userId,
      data.status === "active" ? "listing_approved" : "listing_rejected",
      "listing",
      data.listing_id,
      { review_note: data.review_note ?? null },
    );
    return { ok: true as const };
  });

export const getAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    const admin = await requireAdmin(context.userId);
    const [
      { data: listings },
      { data: users },
      { data: reports },
      { data: orders },
      { data: payouts },
      { data: refunds },
      { data: auditLog },
    ] = await Promise.all([
      admin
        .from("listings")
        .select(
          "id,title,status,kind,price,currency,created_at,seller_id,review_note,public_profiles:public_profiles!listings_seller_public_fkey(display_name,username)",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("profiles")
        .select("id,display_name,username,email,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("reports")
        .select("id,listing_id,reason,details,status,created_at,reporter_id")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("orders")
        .select(
          "id,amount,currency,platform_fee,seller_earnings,status,created_at,listing_id,seller_id,buyer_id",
        )
        .order("created_at", { ascending: false })
        .limit(500),
      admin
        .from("payout_requests")
        .select(
          "id,user_id,amount,currency,status,created_at,method_id,admin_note,provider_reference,processed_at,payout_methods:method_id(method_type,upi_number,bank_name,bank_ifsc,account_holder_name)",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("refund_requests")
        .select(
          "id,order_id,buyer_id,reason,details,status,admin_note,created_at,updated_at,resolved_at",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("admin_audit_log")
        .select("id,admin_id,action,target_type,target_id,metadata,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    return {
      listings: listings ?? [],
      users: users ?? [],
      reports: reports ?? [],
      orders: orders ?? [],
      payouts: payouts ?? [],
      refunds: refunds ?? [],
      auditLog: auditLog ?? [],
    };
  });

export const resolveReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({ report_id: z.string().uuid(), status: z.enum(["resolved", "dismissed"]) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context.userId);
    const { error } = await admin
      .from("reports")
      .update({ status: data.status })
      .eq("id", data.report_id);
    if (error) throw new Error(error.message);
    await audit(admin, context.userId, `report_${data.status}`, "report", data.report_id);
    return { ok: true as const };
  });

export const resolvePayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        payout_id: z.string().uuid(),
        status: z.enum(["paid", "rejected"]),
        admin_note: z.string().trim().max(500).optional(),
        provider_reference: z.string().trim().max(200).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context.userId);
    const { error } = await admin
      .from("payout_requests")
      .update({
        status: data.status,
        admin_note: data.admin_note?.trim() || null,
        provider_reference: data.provider_reference?.trim() || null,
      })
      .eq("id", data.payout_id)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    await audit(admin, context.userId, `payout_${data.status}`, "payout_request", data.payout_id, {
      provider_reference: data.provider_reference ?? null,
      admin_note: data.admin_note ?? null,
    });
    return { ok: true as const };
  });

export const resolveRefundRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        refund_id: z.string().uuid(),
        status: z.enum(["under_review", "approved", "rejected", "resolved"]),
        admin_note: z.string().trim().max(1000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context.userId);
    const { error } = await admin
      .from("refund_requests")
      .update({
        status: data.status,
        admin_note: data.admin_note?.trim() || null,
        resolved_at: ["approved", "rejected", "resolved"].includes(data.status)
          ? new Date().toISOString()
          : null,
      })
      .eq("id", data.refund_id);
    if (error) throw new Error(error.message);
    await audit(admin, context.userId, `refund_${data.status}`, "refund_request", data.refund_id, {
      admin_note: data.admin_note ?? null,
    });
    return { ok: true as const };
  });

export const adminExecuteRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ refund_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context.userId);

    const { data: refund, error } = await admin
      .from("refund_requests")
      .select("id,order_id,status")
      .eq("id", data.refund_id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!refund) throw new Error("Refund request not found");

    if (!["approved", "under_review"].includes(refund.status)) {
      throw new Error("Refund must be approved or under review before provider execution");
    }

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id,provider,provider_payment_id,amount,currency")
      .eq("id", refund.order_id)
      .maybeSingle();

    if (orderError) throw new Error(orderError.message);
    if (!order?.provider_payment_id) {
      throw new Error("Order has no provider payment ID");
    }

    const { createStripeRefund, createRazorpayRefund } =
      await import("./production-integrations.server");

    const providerRefund =
      order.provider === "stripe"
        ? await createStripeRefund(order.provider_payment_id, Number(order.amount))
        : await createRazorpayRefund(order.provider_payment_id, Number(order.amount));

    const { error: updateError } = await admin
      .from("refund_requests")
      .update({
        status: "resolved",
        admin_note: `${String(order.provider).toUpperCase()} refund ${providerRefund?.id ?? "submitted"}`,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", refund.id);

    if (updateError) throw new Error(updateError.message);

    await audit(admin, context.userId, "refund_resolved", "refund_request", refund.id, {
      provider: order.provider,
      provider_refund_id: providerRefund?.id ?? null,
    });

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
    const admin = await requireAdmin(context.userId);

    const { data: payout, error } = await admin
      .from("payout_requests")
      .select("id,user_id,amount,currency,status,method_id")
      .eq("id", data.payout_id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!payout || payout.status !== "pending") {
      throw new Error("Payout is not pending");
    }

    const { data: method, error: methodError } = await admin
      .from("payout_methods")
      .select("provider_fund_account_id,method_type")
      .eq("id", payout.method_id)
      .eq("user_id", payout.user_id)
      .maybeSingle();

    if (methodError) throw new Error(methodError.message);

    if (!method?.provider_fund_account_id) {
      throw new Error("This payout method is not linked to a RazorpayX fund account");
    }

    const { createRazorpayXVendorPayout } = await import("./production-integrations.server");

    const provider = await createRazorpayXVendorPayout({
      amount: Number(payout.amount),
      currency: String(payout.currency),
      fundAccountId: method.provider_fund_account_id,
      referenceId: `velora_${payout.id.replaceAll("-", "").slice(0, 30)}`,
      mode: method.method_type === "upi" ? "UPI" : "IMPS",
    });

    const providerId = provider?.id ?? provider?.payout?.id ?? null;

    const { error: updateError } = await admin
      .from("payout_requests")
      .update({
        status: provider?.status === "processed" ? "paid" : "pending",
        provider_reference: providerId,
        admin_note: `RazorpayX payout ${providerId ?? "submitted"}`,
      })
      .eq("id", payout.id)
      .eq("status", "pending");

    if (updateError) throw new Error(updateError.message);

    await audit(admin, context.userId, "payout_provider_execution", "payout_request", payout.id, {
      provider_reference: providerId,
      provider_status: provider?.status ?? "queued",
    });

    return {
      ok: true as const,
      providerId,
      status: provider?.status ?? "queued",
    };
  });
