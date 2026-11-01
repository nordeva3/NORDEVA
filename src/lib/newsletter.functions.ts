import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email().max(320);

const recentRequests = new Map<string, number[]>();

function rateLimit(key: string, max = 5, windowMs = 60_000) {
  const now = Date.now();
  const hits = (recentRequests.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  recentRequests.set(key, hits);
  return true;
}

export const subscribeNewsletter = createServerFn({ method: "POST" })
  .validator((data) => z.object({ email: emailSchema }).parse(data))
  .handler(async ({ data }) => {
    const email = data.email;
    const key = `newsletter:${email}`;
    if (!rateLimit(key, 3, 10 * 60_000)) {
      return { ok: false as const, message: "Please try again later." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("newsletter_subscribers")
      .upsert({ email, status: "active" }, { onConflict: "email" });

    if (error) throw new Error("Could not subscribe right now");
    return { ok: true as const };
  });
