import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getListingDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ listing_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load listing
    const { data: listing, error: lErr } = await supabase
      .from("listings")
      .select("id, seller_id, file_path, file_name")
      .eq("id", data.listing_id)
      .maybeSingle();
    if (lErr) throw new Error(lErr.message);
    if (!listing) throw new Error("Listing not found");
    if (!listing.file_path) throw new Error("No deliverable file attached to this listing");

    // Authorize: seller OR completed-order buyer
    let authorized = listing.seller_id === userId;
    if (!authorized) {
      const { data: order } = await supabase
        .from("orders")
        .select("id")
        .eq("listing_id", listing.id)
        .eq("buyer_id", userId)
        .eq("status", "completed")
        .limit(1)
        .maybeSingle();
      authorized = !!order;
    }
    if (!authorized) throw new Error("You have not purchased this item");

    // Sign URL with admin client (bypasses RLS on storage)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("listing-files")
      .createSignedUrl(listing.file_path, 60 * 10, {
        download: listing.file_name ?? true,
      });
    if (sErr || !signed) throw new Error(sErr?.message ?? "Failed to create download URL");

    return { url: signed.signedUrl, file_name: listing.file_name };
  });
