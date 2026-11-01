import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function withSecurityHeaders(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (new URL(request.url).protocol === "https:")
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/robots.txt" && request.method === "GET") {
        const origin = process.env.VITE_APP_URL || url.origin;
        return new Response(
          [
            "User-agent: *",
            "Allow: /",
            "Disallow: /dashboard",
            "Disallow: /earnings",
            "Disallow: /checkout/",
            "Disallow: /purchases",
            "Disallow: /wishlist",
            "Disallow: /cart",
            "Disallow: /notifications",
            "Disallow: /auth",
            `Sitemap: ${origin.replace(/\/$/, "")}/sitemap.xml`,
            "",
          ].join("\n"),
          { headers: { "content-type": "text/plain; charset=utf-8" } },
        );
      }

      if (url.pathname === "/sitemap.xml" && request.method === "GET") {
        const origin = (process.env.VITE_APP_URL || url.origin).replace(/\/$/, "");
        const publicPaths = ["/", "/browse", "/privacy", "/terms"];
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPaths.map((path) => `<url><loc>${origin}${path}</loc></url>`).join("")}</urlset>`;
        return new Response(xml, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      }

      if (url.pathname === "/api/health" && request.method === "GET") {
        // Do not disclose which private integrations/secrets are configured.
        // A public health endpoint only needs to report application liveness.
        return Response.json({
          ok: true,
          service: "lume-marketplace",
          timestamp: new Date().toISOString(),
        });
      }

      if (url.pathname === "/api/stripe-webhook" && request.method === "POST") {
        const { handleStripeWebhook, verifyStripeWebhookSignature } =
          await import("./lib/payment.functions");
        const rawBody = await request.text();
        const signature = request.headers.get("stripe-signature") ?? "";
        if (!signature || !(await verifyStripeWebhookSignature(rawBody, signature))) {
          return Response.json({ ok: false, error: "Invalid signature" }, { status: 401 });
        }
        const eventId = request.headers.get("stripe-event-id") ?? "";
        try {
          const { supabaseAdmin } = await import("./integrations/supabase/client.server");
          const payload = JSON.parse(rawBody);
          const actualEventId = String(
            payload?.id || eventId || `${Date.now()}:${signature.slice(0, 16)}`,
          );
          const eventType = String(payload?.type ?? "unknown");
          const { data: existing } = await supabaseAdmin
            .from("webhook_deliveries")
            .select("id,status")
            .eq("provider", "stripe")
            .eq("event_id", actualEventId)
            .maybeSingle();
          if (existing?.status === "processed") return Response.json({ ok: true, duplicate: true });
          await supabaseAdmin.from("webhook_deliveries").upsert(
            {
              provider: "stripe",
              event_id: actualEventId,
              event_type: eventType,
              status: "received",
              payload,
              attempts: 1,
            },
            { onConflict: "provider,event_id" },
          );
          await handleStripeWebhook(payload);
          await supabaseAdmin
            .from("webhook_deliveries")
            .update({ status: "processed", processed_at: new Date().toISOString() })
            .eq("provider", "stripe")
            .eq("event_id", actualEventId);
          return Response.json({ ok: true });
        } catch (error) {
          console.error("Stripe webhook error", error);
          return Response.json({ ok: false }, { status: 500 });
        }
      }

      if (url.pathname === "/api/worker/email" && request.method === "POST") {
        const workerSecret = process.env.WORKER_SECRET;
        if (!workerSecret || request.headers.get("x-worker-secret") !== workerSecret)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const { supabaseAdmin } = await import("./integrations/supabase/client.server");
        const providerUrl = process.env.EMAIL_PROVIDER_URL;
        const providerToken = process.env.EMAIL_PROVIDER_TOKEN;
        if (!providerUrl || !providerToken)
          return Response.json(
            { ok: false, error: "Email provider not configured" },
            { status: 503 },
          );
        const { data: jobs, error } = await supabaseAdmin
          .from("email_outbox")
          .select("*")
          .eq("status", "queued")
          .lte("available_at", new Date().toISOString())
          .order("created_at", { ascending: true })
          .limit(10);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        let sent = 0,
          failed = 0;
        for (const job of jobs ?? []) {
          const claim = await supabaseAdmin
            .from("email_outbox")
            .update({ status: "processing", attempts: Number(job.attempts || 0) + 1 })
            .eq("id", job.id)
            .eq("status", "queued")
            .select("id")
            .maybeSingle();
          if (!claim.data) continue;
          try {
            const r = await fetch(providerUrl, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${providerToken}`,
              },
              body: JSON.stringify({
                to: job.recipient_email,
                subject: job.subject,
                template: job.template_key,
                data: job.payload,
              }),
            });
            const body = await r.text();
            let parsed: any = {};
            try {
              parsed = body ? JSON.parse(body) : {};
            } catch {
              /* non-JSON provider response: treat as empty */
            }
            if (!r.ok) throw new Error(parsed?.error || `Email provider returned ${r.status}`);
            await supabaseAdmin
              .from("email_outbox")
              .update({
                status: "sent",
                provider_message_id: parsed?.id ?? parsed?.message_id ?? null,
                sent_at: new Date().toISOString(),
                last_error: null,
              })
              .eq("id", job.id);
            sent++;
          } catch (e) {
            const attempts = Number(job.attempts || 0) + 1;
            await supabaseAdmin
              .from("email_outbox")
              .update({
                status: attempts >= 5 ? "failed" : "queued",
                available_at: new Date(
                  Date.now() + Math.min(60 * 60 * 1000, 2 ** attempts * 1000),
                ).toISOString(),
                last_error: e instanceof Error ? e.message : "Email delivery failed",
              })
              .eq("id", job.id);
            failed++;
          }
        }
        return Response.json({ ok: true, sent, failed });
      }

      if (url.pathname === "/api/worker/malware" && request.method === "POST") {
        const workerSecret = process.env.WORKER_SECRET;
        if (!workerSecret || request.headers.get("x-worker-secret") !== workerSecret)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const providerUrl = process.env.MALWARE_SCANNER_URL;
        const providerToken = process.env.MALWARE_SCANNER_TOKEN;
        if (!providerUrl || !providerToken)
          return Response.json(
            { ok: false, error: "Malware scanner not configured" },
            { status: 503 },
          );
        const { supabaseAdmin } = await import("./integrations/supabase/client.server");
        const { data: jobs, error } = await supabaseAdmin
          .from("malware_scans")
          .select("id,listing_id,asset_id,scanner,scanner_version,status")
          .eq("status", "queued")
          .order("scanned_at", { ascending: true })
          .limit(10);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        let clean = 0,
          infected = 0,
          failed = 0;
        for (const job of jobs ?? []) {
          try {
            if (!job.asset_id || !job.listing_id)
              throw new Error("Scan job is missing its asset or listing reference");
            const { data: asset } = await supabaseAdmin
              .from("listing_assets")
              .select("storage_path,file_name,mime_type,file_size,checksum_sha256")
              .eq("id", job.asset_id)
              .single();
            if (!asset) throw new Error("Asset not found");
            const r = await fetch(providerUrl, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${providerToken}`,
              },
              body: JSON.stringify({
                listing_id: job.listing_id,
                asset_id: job.asset_id,
                path: asset.storage_path,
                file_name: asset.file_name,
                mime_type: asset.mime_type,
                file_size: asset.file_size,
                sha256: asset.checksum_sha256,
              }),
            });
            const body = await r.text();
            let result: any = {};
            try {
              result = body ? JSON.parse(body) : {};
            } catch {
              /* non-JSON scanner response: treat as empty */
            }
            if (!r.ok) throw new Error(result?.error || `Scanner returned ${r.status}`);
            const status =
              result.status === "infected"
                ? "infected"
                : result.status === "clean"
                  ? "clean"
                  : "error";
            await supabaseAdmin
              .from("malware_scans")
              .update({
                status,
                scanner_version: result.scanner_version ?? job.scanner_version,
                signature: result.signature ?? null,
                findings: result.findings ?? null,
                scanned_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            if (status === "infected") {
              await supabaseAdmin
                .from("listings")
                .update({
                  status: "rejected",
                  review_note: "Automated malware scanner flagged a downloadable asset.",
                })
                .eq("id", job.listing_id);
              infected++;
            } else if (status === "clean") clean++;
            else failed++;
          } catch (e) {
            await supabaseAdmin
              .from("malware_scans")
              .update({
                status: "error",
                findings: { error: e instanceof Error ? e.message : "Scanner error" },
                scanned_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            failed++;
          }
        }
        return Response.json({ ok: true, clean, infected, failed });
      }

      if (url.pathname === "/api/razorpay-webhook" && request.method === "POST") {
        const { handleRazorpayWebhook, verifyRazorpayWebhookSignature } =
          await import("./lib/payment.functions");
        const rawBody = await request.text();
        const signature = request.headers.get("x-razorpay-signature") ?? "";
        const eventId =
          request.headers.get("x-razorpay-event-id") ?? `${Date.now()}:${signature.slice(0, 16)}`;
        if (!signature || !(await verifyRazorpayWebhookSignature(rawBody, signature))) {
          return Response.json({ ok: false, error: "Invalid signature" }, { status: 401 });
        }
        try {
          const { supabaseAdmin } = await import("./integrations/supabase/client.server");
          const payload = JSON.parse(rawBody);
          const eventType = String(payload?.event ?? "unknown");
          const { error: logError } = await supabaseAdmin.from("webhook_deliveries").upsert(
            {
              provider: "razorpay",
              event_id: eventId,
              event_type: eventType,
              status: "received",
              payload,
              attempts: 1,
            },
            { onConflict: "provider,event_id" },
          );
          if (logError) console.error("Webhook audit log error", logError);
          await handleRazorpayWebhook(payload);
          await supabaseAdmin
            .from("webhook_deliveries")
            .update({ status: "processed", processed_at: new Date().toISOString() })
            .eq("provider", "razorpay")
            .eq("event_id", eventId);
          return Response.json({ ok: true });
        } catch (error) {
          console.error("Razorpay webhook error", error);
          try {
            const { supabaseAdmin } = await import("./integrations/supabase/client.server");
            await supabaseAdmin
              .from("webhook_deliveries")
              .update({
                status: "failed",
                error_message: error instanceof Error ? error.message : "Unknown webhook error",
              })
              .eq("provider", "razorpay")
              .eq("event_id", eventId);
          } catch (auditError) {
            console.error("Webhook failure audit error", auditError);
          }
          return Response.json({ ok: false }, { status: 500 });
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response), request);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
