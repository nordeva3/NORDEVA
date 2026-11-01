import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef } from "react";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { signInWithUsername } from "@/lib/auth.functions";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const searchSchema = z.object({ next: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  component: AuthPage,
});

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const AUTH_NEXT_KEY = "lume-auth-next";

function safeNextPath(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

async function ensureProfile(user: User, username?: string) {
  try {
    const displayName =
      user.user_metadata?.display_name ??
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      username ??
      user.email?.split("@")[0] ??
      "NORDEVA user";
    const cleanUsername = username && USERNAME_RE.test(username) ? username : undefined;

    const { data: existing } = await supabase
      .from("profiles")
      .select("id,username")
      .eq("id", user.id)
      .maybeSingle();

    if (existing) {
      const payload: { email: string | null; display_name: string; username?: string } = {
        email: user.email ?? null,
        display_name: displayName,
      };
      if (!existing.username && cleanUsername) payload.username = cleanUsername;
      await supabase.from("profiles").update(payload).eq("id", user.id);
      return;
    }

    await supabase.from("profiles").insert({
      id: user.id,
      email: user.email ?? null,
      display_name: displayName,
      username: cleanUsername ?? null,
    });
  } catch {
    // Non-fatal: profile is auto-created by DB trigger on signup.
  }
}

function AuthPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const signInUsername = useServerFn(signInWithUsername);
  const targetPath = useMemo(() => {
    const stored = typeof window !== "undefined" ? sessionStorage.getItem(AUTH_NEXT_KEY) : null;
    return safeNextPath(next ?? stored);
  }, [next]);
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">("signin");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigatedRef = useRef(false);

  // Redirect if already signed in when landing on /auth, except recovery links.
  useEffect(() => {
    let alive = true;
    const recovery = typeof window !== "undefined" && /type=recovery/i.test(window.location.hash);
    if (recovery) {
      setMode("reset");
      return () => {
        alive = false;
      };
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!alive || navigatedRef.current) return;
      if (data.session?.user) {
        navigatedRef.current = true;
        sessionStorage.removeItem(AUTH_NEXT_KEY);
        navigate({ to: targetPath as never, replace: true });
      }
    });
    return () => {
      alive = false;
    };
  }, [targetPath, navigate]);

  const goToTarget = () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    sessionStorage.removeItem(AUTH_NEXT_KEY);
    navigate({ to: targetPath as never, replace: true });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      if (mode === "reset") {
        if (password.length < 8) throw new Error("Password must be at least 8 characters.");
        if (password !== confirmPassword) throw new Error("Passwords do not match.");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success("Password updated successfully.");
        setMode("signin");
        setPassword("");
        setConfirmPassword("");
        return;
      }
      if (mode === "forgot") {
        const recoveryEmail = email || identifier;
        if (!recoveryEmail || !recoveryEmail.includes("@"))
          throw new Error("Enter your account email.");
        const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail.trim(), {
          redirectTo: `${window.location.origin}/auth?next=/dashboard`,
        });
        if (error) throw error;
        toast.success("Password reset email sent. Check your inbox.");
        setMode("signin");
        setIdentifier(recoveryEmail);
        return;
      }
      if (mode === "signup") {
        if (!USERNAME_RE.test(username)) {
          throw new Error("Username must be 3–20 chars: letters, numbers, or underscore.");
        }
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters.");
        }
        const { data: signUpData, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: name || username, username },
          },
        });
        if (error) {
          const m = error.message.toLowerCase();
          if (m.includes("already") || m.includes("registered")) {
            throw new Error("An account with that email already exists. Try signing in.");
          }
          throw error;
        }
        if (!signUpData.session) {
          toast.success("Account created. Check your email to confirm, then sign in.");
          setMode("signin");
          setIdentifier(email);
          setLoading(false);
          return;
        }
        if (signUpData.user) await ensureProfile(signUpData.user, username);
        toast.success("Account created. You're signed in.");
        goToTarget();
        return;
      }

      // Sign-in
      const loginEmail = identifier.trim();
      if (!loginEmail) throw new Error("Enter your email or username.");
      if (!loginEmail.includes("@")) {
        if (!USERNAME_RE.test(loginEmail)) {
          throw new Error("Enter a valid email or username.");
        }
        const result = await signInUsername({ data: { username: loginEmail, password } });
        const { error: sessionError } = await supabase.auth.setSession(result.session);
        if (sessionError) throw sessionError;
        toast.success("Welcome back.");
        goToTarget();
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (error) {
        const m = error.message.toLowerCase();
        if (m.includes("invalid") || m.includes("credentials")) {
          throw new Error("Invalid username/email or password.");
        }
        if (m.includes("confirm")) {
          throw new Error("Please confirm your email before signing in.");
        }
        throw error;
      }
      if (!data.user) throw new Error("Sign-in did not finish. Please try again.");
      // Fire-and-forget profile sync; don't block navigation.
      void ensureProfile(data.user);
      goToTarget();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  const google = async () => {
    if (loading) return;
    setLoading(true);
    try {
      sessionStorage.setItem(AUTH_NEXT_KEY, targetPath);
      const callback = new URL("/auth", window.location.origin);
      callback.searchParams.set("next", targetPath);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callback.toString() },
      });
      if (error) throw error;
      // Supabase redirects the browser to Google and back to /auth.
      return;
    } catch (err: unknown) {
      // Never fail silently: a disabled provider used to look like a dead
      // button. Tell the visitor plainly and point at the email form.
      const raw = err instanceof Error ? err.message : "";
      toast.error(
        /provider|not enabled|not configured/i.test(raw)
          ? "Google sign-in isn't switched on yet. Please sign in with your email below — or create an account first."
          : raw || "Google sign-in failed. Please try email instead.",
      );
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-2xl border border-border/60 bg-card p-8">
          <h1 className="text-2xl font-semibold text-center">
            {mode === "signin"
              ? "Welcome back"
              : mode === "signup"
                ? "Join NORDEVA"
                : mode === "forgot"
                  ? "Reset your password"
                  : "Choose a new password"}
          </h1>
          <p className="text-sm text-center text-muted-foreground mt-1">
            {mode === "signin"
              ? "Sign in with your username or email."
              : mode === "signup"
                ? "Create an account to buy or sell."
                : mode === "forgot"
                  ? "We’ll email you a secure password reset link."
                  : "Your new password must be at least 8 characters."}
          </p>

          {mode !== "forgot" && mode !== "reset" && (
            <Button
              type="button"
              variant="outline"
              className="w-full mt-6"
              onClick={google}
              disabled={loading}
            >
              {loading ? "Please wait…" : "Continue with Google"}
            </Button>
          )}

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "reset" ? (
              <>
                <div>
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </>
            ) : mode === "forgot" ? (
              <div>
                <Label htmlFor="recovery-email">Email</Label>
                <Input
                  id="recovery-email"
                  type="email"
                  required
                  value={email || identifier}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </div>
            ) : mode === "signup" ? (
              <>
                <div>
                  <Label htmlFor="name">Display name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    required
                    minLength={3}
                    maxLength={20}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="letters, numbers, _ (3–20)"
                    autoComplete="username"
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">At least 8 characters.</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor="identifier">Username or email</Label>
                  <Input
                    id="identifier"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    autoComplete="username"
                  />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
              </>
            )}
            <Button
              type="submit"
              disabled={loading}
              className="w-full lume-gradient text-white hover:opacity-90"
            >
              {loading
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "forgot"
                      ? "Send reset link"
                      : "Update password"}
            </Button>
          </form>

          <div className="mt-4 space-y-2 text-center">
            {(mode === "signin" || mode === "signup") && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="w-full"
              >
                {mode === "signin"
                  ? "New to NORDEVA? Create an account"
                  : "Already have an account? Sign in"}
              </Button>
            )}
            {mode === "signin" && (
              <button
                onClick={() => setMode("forgot")}
                className="text-xs text-lume hover:underline"
              >
                Forgot password?
              </button>
            )}
            {mode === "forgot" && (
              <button
                onClick={() => setMode("signin")}
                className="text-xs text-lume hover:underline"
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
