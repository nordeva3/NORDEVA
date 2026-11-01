import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Wave M5 — suspension enforcement read model.
 *
 * adminUpdateUser has always been able to record a user's state in
 * admin_user_controls (active / restricted / suspended / banned), but
 * nothing ever read it back. This is the single authoritative read: the
 * caller's own standing, fetched with the service role after the auth
 * middleware has established who the caller is. Clients never query
 * admin_user_controls directly.
 *
 * "suspended" here means the two hard states — suspended and banned.
 * "restricted" is a softer admin note and does not pause the account.
 */
export const getMyAccountStanding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("admin_user_controls")
      .select("state,note")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const state = data?.state ?? "active";
    return {
      suspended: state === "suspended" || state === "banned",
      state,
      reason: data?.note ?? null,
    };
  });
