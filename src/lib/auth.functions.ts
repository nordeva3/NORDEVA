import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/**
 * Username login is performed entirely on the server so the account email is
 * never returned to the browser. Failed lookups and password failures share a
 * generic response to reduce account enumeration.
 */
export const signInWithUsername = createServerFn({ method: "POST" })
  .validator((data) =>
    z
      .object({
        username: z.string().min(3).max(20).regex(USERNAME_RE),
        password: z.string().min(1).max(200),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rateKey = `username-login:${data.username.toLowerCase()}`;
    const { data: allowed, error: rateError } = await supabaseAdmin.rpc("consume_rate_limit", {
      p_key: rateKey,
      p_limit: 8,
      p_window_seconds: 300,
    });
    if (rateError || allowed !== true) throw new Error("Invalid username or password.");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .ilike("username", data.username)
      .maybeSingle();

    const supabaseUrl =
      process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
    const publishableKey =
      process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
    if (!supabaseUrl || !publishableKey || !profile?.email)
      throw new Error("Invalid username or password.");

    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error } = await authClient.auth.signInWithPassword({
      email: profile.email,
      password: data.password,
    });
    if (error || !authData.session) throw new Error("Invalid username or password.");
    return { session: authData.session };
  });

/** @deprecated Kept for compatibility; username login should use signInWithUsername. */
export const resolveUsernameToEmail = createServerFn({ method: "POST" })
  .validator((data) =>
    z.object({ username: z.string().min(3).max(20).regex(USERNAME_RE) }).parse(data),
  )
  .handler(async () => {
    throw new Error(
      "Username email resolution is no longer exposed. Use username sign-in instead.",
    );
  });
