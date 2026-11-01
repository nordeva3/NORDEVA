import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { effectiveStatus } from "./project-requests";

async function adminDb(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Admin access required");
  return supabaseAdmin as any;
}

async function writeAudit(
  db: any,
  userId: string,
  action: string,
  targetType: string,
  targetId?: string,
  metadata: Record<string, unknown> = {},
) {
  await db.rpc("write_admin_audit", {
    p_admin_id: userId,
    p_action: action,
    p_target_type: targetType,
    p_target_id: targetId ?? null,
    p_metadata: metadata,
  });
}

export const getAdminCommandCenter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    const db = await adminDb(context.userId);
    const [
      users,
      listings,
      orders,
      reports,
      refunds,
      payouts,
      verifications,
      tickets,
      tasks,
      analytics,
      revenue,
      projects,
      proposals,
    ] = await Promise.all([
      db
        .from("profiles")
        .select("id,display_name,username,email,created_at")
        .order("created_at", { ascending: false })
        .limit(250),
      db
        .from("listings")
        .select(
          "id,title,status,kind,price,currency,created_at,seller_id,review_note,cover_url,category,public_profiles:public_profiles!listings_seller_public_fkey(display_name,username)",
        )
        .order("created_at", { ascending: false })
        .limit(250),
      db
        .from("orders")
        .select(
          "id,amount,currency,platform_fee,seller_earnings,status,created_at,listing_id,seller_id,buyer_id,buyer_email",
        )
        .order("created_at", { ascending: false })
        .limit(500),
      db
        .from("reports")
        .select("id,listing_id,reason,details,status,created_at,reporter_id")
        .order("created_at", { ascending: false })
        .limit(250),
      db
        .from("refund_requests")
        .select(
          "id,order_id,buyer_id,reason,details,status,admin_note,created_at,updated_at,resolved_at",
        )
        .order("created_at", { ascending: false })
        .limit(250),
      db
        .from("payout_requests")
        .select(
          "id,user_id,amount,currency,status,created_at,method_id,admin_note,provider_reference,processed_at,payout_methods:method_id(method_type,upi_number,bank_name,bank_ifsc,account_holder_name)",
        )
        .order("created_at", { ascending: false })
        .limit(250),
      db
        .from("seller_verifications")
        .select(
          "id,user_id,status,legal_name,country_code,tax_id,website,notes,reviewed_by,reviewed_at,created_at,updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(250),
      db
        .from("support_tickets")
        .select(
          "id,user_id,order_id,subject,category,priority,status,assigned_to,created_at,updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(250),
      db
        .from("admin_tasks")
        .select(
          "id,task_type,target_id,title,priority,status,assigned_to,metadata,created_at,updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(250),
      db
        .from("analytics_events")
        .select("id,event_name,listing_id,path,utm_source,utm_medium,utm_campaign,created_at")
        .order("created_at", { ascending: false })
        .limit(1000),
      db
        .from("orders")
        .select("amount,platform_fee,currency,status,created_at")
        .eq("status", "completed")
        .limit(5000),
      // select("*") so this keeps working before the project-upgrade
      // migration lands (fewer columns) as well as after it.
      db.from("website_requests").select("*").order("created_at", { ascending: false }).limit(250),
      // Missing entirely before the upgrade migration — the query errors,
      // data stays null, and proposal counts simply read as empty.
      db.from("project_proposals").select("request_id,status").limit(1000),
    ]);
    // M5: report targets (profile / message) and dispute records. All
    // failure-isolated: on a database where the ecosystem migration has not
    // landed yet, these queries error, data stays null, and the command
    // center falls back to the listing-only view it has always had.
    const reportRows: any[] = reports.data ?? [];
    const { data: reportTargets } = reportRows.length
      ? await db
          .from("reports")
          .select("id,reported_user_id,message_id")
          .in(
            "id",
            reportRows.map((r: any) => r.id),
          )
      : { data: null };
    const targetList: any[] = reportTargets ?? [];
    const targetById = new Map(targetList.map((t: any) => [t.id, t]));
    const messageIds = [...new Set(targetList.map((t: any) => t.message_id).filter(Boolean))];
    const { data: targetMessages } = messageIds.length
      ? await db
          .from("messages")
          .select("id,body,sender_id,conversation_id,created_at")
          .in("id", messageIds)
      : { data: null };
    const messageList: any[] = targetMessages ?? [];
    const conversationIds = [
      ...new Set(messageList.map((m: any) => m.conversation_id).filter(Boolean)),
    ];
    const { data: targetConversations } = conversationIds.length
      ? await db.from("conversations").select("id,buyer_id,seller_id").in("id", conversationIds)
      : { data: null };
    const conversationList: any[] = targetConversations ?? [];
    const conversationById = new Map(conversationList.map((c: any) => [c.id, c]));
    const enrichedReports = reportRows.map((r: any) => {
      const target = targetById.get(r.id);
      const message = target?.message_id
        ? (messageList.find((m: any) => m.id === target.message_id) ?? null)
        : null;
      return {
        ...r,
        reported_user_id: target?.reported_user_id ?? null,
        message_id: target?.message_id ?? null,
        target_message: message
          ? {
              body: message.body,
              sender_id: message.sender_id,
              created_at: message.created_at,
              conversation: conversationById.get(message.conversation_id) ?? null,
            }
          : null,
      };
    });

    const { data: disputeRows } = await db
      .from("project_disputes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250);
    const disputeList: any[] = disputeRows ?? [];
    const disputeProjectIds = [...new Set(disputeList.map((x: any) => x.project_id))];
    const { data: disputePayments } = disputeProjectIds.length
      ? await db
          .from("project_payments")
          .select("id,request_id,status,amount,currency,created_at")
          .in("request_id", disputeProjectIds)
          .order("created_at", { ascending: false })
      : { data: null };
    const disputes = disputeList.map((x: any) => ({
      ...x,
      payment: (disputePayments ?? []).find((p: any) => p.request_id === x.project_id) ?? null,
    }));

    const projectRows = projects.data ?? [];
    const projectProposalCounts: Record<string, number> = {};
    for (const p of proposals.data ?? []) {
      if (p.status === "withdrawn") continue;
      projectProposalCounts[p.request_id] = (projectProposalCounts[p.request_id] ?? 0) + 1;
    }
    const completed = revenue.data ?? [];
    const totalRevenue = completed.reduce((n: number, o: any) => n + Number(o.amount || 0), 0);
    const platformFees = completed.reduce(
      (n: number, o: any) => n + Number(o.platform_fee || 0),
      0,
    );
    const byStatus = (items: any[]) =>
      items.reduce((a: Record<string, number>, x: any) => {
        a[x.status] = (a[x.status] || 0) + 1;
        return a;
      }, {});
    return {
      users: users.data ?? [],
      listings: listings.data ?? [],
      orders: orders.data ?? [],
      reports: enrichedReports,
      disputes,
      refunds: refunds.data ?? [],
      payouts: payouts.data ?? [],
      verifications: verifications.data ?? [],
      tickets: tickets.data ?? [],
      tasks: tasks.data ?? [],
      analytics: analytics.data ?? [],
      projects: projectRows,
      projectProposalCounts,
      stats: {
        totalUsers: users.data?.length ?? 0,
        totalListings: listings.data?.length ?? 0,
        totalOrders: orders.data?.length ?? 0,
        totalRevenue,
        platformFees,
        pendingListings: (listings.data ?? []).filter((x: any) => x.status === "pending").length,
        openReports: (reports.data ?? []).filter((x: any) => x.status === "open").length,
        openDisputes: disputes.filter((x: any) => x.status === "open").length,
        openTickets: (tickets.data ?? []).filter(
          (x: any) => !["resolved", "closed"].includes(x.status),
        ).length,
        pendingVerifications: (verifications.data ?? []).filter((x: any) => x.status === "pending")
          .length,
        totalProjects: projectRows.length,
        disputedProjects: projectRows.filter((x: any) => effectiveStatus(x) === "disputed").length,
        status: {
          listings: byStatus(listings.data ?? []),
          orders: byStatus(orders.data ?? []),
          refunds: byStatus(refunds.data ?? []),
        },
      },
    };
  });

export const adminUpdateListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        listing_id: z.string().uuid(),
        status: z.enum(["active", "rejected", "pending"]),
        review_note: z.string().max(1000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = await adminDb(context.userId);
    const { error } = await db
      .from("listings")
      .update({ status: data.status, review_note: data.review_note?.trim() || null })
      .eq("id", data.listing_id);
    if (error) throw new Error(error.message);
    await writeAudit(db, context.userId, `listing_${data.status}`, "listing", data.listing_id, {
      review_note: data.review_note ?? null,
    });
    return { ok: true };
  });

export const adminUpdateVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        verification_id: z.string().uuid(),
        status: z.enum(["verified", "rejected", "suspended", "pending"]),
        notes: z.string().max(1000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = await adminDb(context.userId);
    const { error } = await db
      .from("seller_verifications")
      .update({
        status: data.status,
        notes: data.notes?.trim() || null,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.verification_id);
    if (error) throw new Error(error.message);
    await writeAudit(
      db,
      context.userId,
      `seller_verification_${data.status}`,
      "seller_verification",
      data.verification_id,
      { notes: data.notes ?? null },
    );
    return { ok: true };
  });

export const adminUpdateTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        ticket_id: z.string().uuid(),
        status: z.enum(["open", "pending", "resolved", "closed"]),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        assigned_to: z.string().uuid().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = await adminDb(context.userId);
    const { error } = await db
      .from("support_tickets")
      .update({ status: data.status, priority: data.priority, assigned_to: data.assigned_to })
      .eq("id", data.ticket_id);
    if (error) throw new Error(error.message);
    await writeAudit(
      db,
      context.userId,
      `support_${data.status}`,
      "support_ticket",
      data.ticket_id,
    );
    return { ok: true };
  });

export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        user_id: z.string().uuid(),
        state: z.enum(["active", "restricted", "suspended", "banned"]),
        note: z.string().max(1000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = await adminDb(context.userId);
    const { error } = await db.from("admin_user_controls").upsert(
      {
        user_id: data.user_id,
        state: data.state,
        note: data.note?.trim() || null,
        updated_by: context.userId,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    await writeAudit(db, context.userId, `user_${data.state}`, "user", data.user_id, {
      note: data.note ?? null,
    });
    return { ok: true };
  });

/**
 * M5 — resolve a project dispute (the reviewable record M1 created and M4
 * raises from the workspace). The dispute row is updated here under the
 * service role with an audit entry. The optional follow-on project status
 * move (disputed → cancelled for the buyer, disputed → completed for the
 * developer) is executed by the admin client through the
 * transition_project_status RPC, whose graph and role rules already allow
 * admins both exits — so status validation stays in exactly one place.
 * Refunds are deliberately NOT executed here: a paid project payment is
 * refunded from the Stripe dashboard, and the charge.refunded webhook
 * updates the payment (and project) status automatically.
 */
export const adminResolveDispute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        dispute_id: z.string().uuid(),
        status: z.enum(["resolved_buyer", "resolved_developer", "resolved_partial", "closed"]),
        admin_note: z.string().trim().max(1000).optional(),
        move_project_to: z.enum(["none", "cancelled", "completed"]).optional(),
      })
      .refine((d) => d.status !== "resolved_partial" || (d.admin_note ?? "").length > 0, {
        message: "A note explaining the partial resolution is required",
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = await adminDb(context.userId);
    const { data: dispute, error: readError } = await db
      .from("project_disputes")
      .select("id,project_id,status")
      .eq("id", data.dispute_id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!dispute) throw new Error("Dispute not found");
    if (dispute.status !== "open") throw new Error("This dispute has already been resolved");

    const { error } = await db
      .from("project_disputes")
      .update({
        status: data.status,
        admin_note: data.admin_note?.trim() || null,
        resolved_by: context.userId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", data.dispute_id)
      .eq("status", "open");
    if (error) throw new Error(error.message);
    await writeAudit(
      db,
      context.userId,
      `dispute_${data.status}`,
      "project_dispute",
      data.dispute_id,
      {
        project_id: dispute.project_id,
        admin_note: data.admin_note ?? null,
        move_project_to: data.move_project_to ?? "none",
      },
    );
    return { ok: true as const, project_id: dispute.project_id as string };
  });

export const adminCreateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        task_type: z.enum([
          "moderation",
          "verification",
          "support",
          "refund",
          "payout",
          "report",
          "security",
        ]),
        target_id: z.string().uuid().nullable().optional(),
        title: z.string().min(2).max(200),
        priority: z.enum(["low", "normal", "high", "urgent"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = await adminDb(context.userId);
    const { data: row, error } = await db
      .from("admin_tasks")
      .insert({ ...data, target_id: data.target_id ?? null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await writeAudit(db, context.userId, "admin_task_created", "admin_task", row.id, {
      task_type: data.task_type,
    });
    return row;
  });
