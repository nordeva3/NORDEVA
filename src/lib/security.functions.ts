import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only: drain the malware scan queue immediately instead of waiting
 * for the scheduled worker ping. Uses the exact same batch code path as
 * POST /api/worker/malware.
 */
export const runScanQueueNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!data) throw new Error("Admin access required");
    const { runMalwareScanBatch } = await import("./malware-worker.server");
    return runMalwareScanBatch(25);
  });
