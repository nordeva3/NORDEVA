import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  appearanceIssues,
  validateAppearance,
  DEFAULT_APPEARANCE,
  type AppearanceConfig,
} from "./appearance";

// platform_settings is service-role only (all access is revoked from anon and
// authenticated roles), so both reads and writes of the appearance config go
// through these server functions. The config itself is public information —
// it is rendered to every visitor — so the read needs no auth; the write
// verifies the admin role server-side before touching the table.
const APPEARANCE_SETTING_KEY = "appearance";

export const getAppearance = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppearanceConfig> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("platform_settings")
        .select("value")
        .eq("key", APPEARANCE_SETTING_KEY)
        .maybeSingle();
      return validateAppearance(data?.value);
    } catch {
      return DEFAULT_APPEARANCE;
    }
  },
);

export const saveAppearance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ config: z.unknown() }).parse(data))
  .handler(async ({ data, context }) => {
    const issues = appearanceIssues(data.config);
    if (issues.length > 0) {
      throw new Error(`Invalid appearance settings: ${issues.join("; ")}`);
    }
    const config = validateAppearance(data.config);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Admin access required");

    const { error } = await supabaseAdmin.from("platform_settings").upsert(
      {
        key: APPEARANCE_SETTING_KEY,
        value: JSON.parse(JSON.stringify(config)),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) throw new Error("Appearance settings could not be saved");

    // Best-effort audit trail, mirroring admin-v2.functions.ts.
    try {
      await (supabaseAdmin as any).rpc("write_admin_audit", {
        p_admin_id: context.userId,
        p_action: "appearance_updated",
        p_target_type: "platform_settings",
        p_target_id: APPEARANCE_SETTING_KEY,
        p_metadata: { preset: config.preset, cardVariant: config.cardVariant },
      });
    } catch {
      // Auditing must never block a valid settings save.
    }

    return { ok: true as const, config };
  });
