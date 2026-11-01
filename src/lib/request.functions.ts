import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const idSchema = z.string().uuid();

export const claimWebsiteRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ request_id: idSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: changed, error } = await (context.supabase as any).rpc("claim_website_request", {
      request_id: data.request_id,
      claimer_id: context.userId,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: Boolean(changed) };
  });

export const completeWebsiteRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ request_id: idSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: changed, error } = await (context.supabase as any).rpc(
      "complete_website_request",
      {
        request_id: data.request_id,
        actor_id: context.userId,
      } as any,
    );
    if (error) throw new Error(error.message);
    return { ok: Boolean(changed) };
  });

export const getWebsiteRequestContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ request_id: idSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: request, error } = await supabaseAdmin
      .from("website_requests")
      .select("contact,requester_id,taken_by")
      .eq("id", data.request_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!request) throw new Error("Request not found");
    if (request.requester_id !== context.userId && request.taken_by !== context.userId) {
      throw new Error("You are not allowed to view this contact");
    }
    return { contact: request.contact as string | null };
  });
