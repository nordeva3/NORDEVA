import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const fileSchema = z.object({
  path: z.string().min(1).max(500),
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
});

/** Seller saves (or clears) the buyer-only content for a listing they own. */
export const savePrivateDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) =>
    z
      .object({
        listing_id: z.string().uuid(),
        content: z.string().max(20000),
        files: z.array(fileSchema).max(10).default([]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: listing, error } = await supabase
      .from("listings")
      .select("id, seller_id")
      .eq("id", data.listing_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!listing || listing.seller_id !== userId) throw new Error("Not your listing");

    const { encryptDelivery, screenDeliveryContent } = await import("./delivery-crypto.server");
    const screen = screenDeliveryContent(
      [data.content, ...data.files.map((f) => f.name)].join("\n"),
    );
    if (!screen.ok) throw new Error(screen.reason!);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: uErr } = await (supabaseAdmin as any).from("listing_private_delivery").upsert(
      {
        listing_id: data.listing_id,
        content_ciphertext: data.content.trim() ? encryptDelivery(data.content) : null,
        files: data.files,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "listing_id" },
    );
    if (uErr) throw new Error(uErr.message);

    return { ok: true as const };
  });

/**
 * Returns the decrypted private delivery for the listing's seller, or for a
 * buyer with a completed order. Nobody else can reach it.
 */
export const getPrivateDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ listing_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: listing, error } = await supabase
      .from("listings")
      .select("id, seller_id")
      .eq("id", data.listing_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!listing) throw new Error("Listing not found");

    let role: "seller" | "buyer" | null = listing.seller_id === userId ? "seller" : null;
    if (!role) {
      const { data: order } = await supabase
        .from("orders")
        .select("id")
        .eq("listing_id", data.listing_id)
        .eq("buyer_id", userId)
        .eq("status", "completed")
        .limit(1)
        .maybeSingle();
      if (order) role = "buyer";
    }
    if (!role) throw new Error("Purchase required to unlock this content");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await (supabaseAdmin as any)
      .from("listing_private_delivery")
      .select("content_ciphertext, files")
      .eq("listing_id", data.listing_id)
      .maybeSingle();

    let content = "";
    if (row?.content_ciphertext) {
      const { decryptDelivery } = await import("./delivery-crypto.server");
      content = decryptDelivery(row.content_ciphertext);
    }

    const files = (row?.files ?? []) as Array<{ path: string; name: string; size: number }>;
    const signed: Array<{ name: string; size: number; url: string }> = [];
    for (const f of files) {
      const { data: s } = await supabaseAdmin.storage
        .from("listing-files")
        .createSignedUrl(f.path, 60 * 10, { download: f.name });
      if (s) signed.push({ name: f.name, size: f.size, url: s.signedUrl });
    }

    return { role, content, files: signed };
  });

/** True when the current user already owns this listing (completed order). */
export const hasPurchased = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ listing_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: order } = await context.supabase
      .from("orders")
      .select("id")
      .eq("listing_id", data.listing_id)
      .eq("buyer_id", context.userId)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle();
    return { owned: !!order };
  });
