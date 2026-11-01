import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, EyeOff, Gauge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { computeProfileCompletion, type ProfileCompletion } from "@/lib/profile-completion";

/**
 * OWNER-ONLY profile completion widget (spec Part 8).
 *
 * Rendered only inside the signed-in user's own dashboard, fed exclusively
 * with that user's own profile row. The percentage and checklist must never
 * be shown on public profiles or to other users, and a high score is a
 * profile-strength signal only — it is not identity verification.
 */
export function ProfileCompletionWidget({
  userId,
  refreshKey = 0,
}: {
  userId: string;
  refreshKey?: number;
}) {
  const [result, setResult] = useState<ProfileCompletion | null>(null);
  // Bar animates from 0 to the computed percent via a CSS width transition
  // (disabled under prefers-reduced-motion by the motion-reduce variant and
  // the global reduced-motion rules in styles.css).
  const [displayPercent, setDisplayPercent] = useState(0);

  useEffect(() => {
    if (!result) return;
    setDisplayPercent(0);
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setDisplayPercent(result.percent));
    });
    return () => cancelAnimationFrame(raf);
  }, [result]);

  useEffect(() => {
    let active = true;
    (async () => {
      const full = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      let profile: Record<string, unknown> | null = null;
      if (!full.error && full.data) {
        profile = full.data as Record<string, unknown>;
      } else {
        // Database update not applied yet: score the long-standing fields.
        const legacy = await supabase
          .from("profiles")
          .select(
            "id,display_name,username,avatar_url,bio,website_url,twitter_url,github_url,email",
          )
          .eq("id", userId)
          .maybeSingle();
        if (!legacy.error && legacy.data) profile = legacy.data as Record<string, unknown>;
      }
      if (!profile) {
        if (active) setResult(null);
        return;
      }
      const [{ count: listingCount }, { count: portfolioCount }] = await Promise.all([
        supabase
          .from("listings")
          .select("id", { count: "exact", head: true })
          .eq("seller_id", userId),
        supabase
          .from("profile_portfolio")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
      ]);
      if (!active) return;
      const str = (v: unknown) => (typeof v === "string" ? v : null);
      const num = (v: unknown) => (typeof v === "number" ? v : null);
      const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : null);
      setResult(
        computeProfileCompletion({
          avatarUrl: str(profile.avatar_url),
          displayName: str(profile.display_name),
          username: str(profile.username),
          headline: str(profile.headline),
          bio: str(profile.bio),
          skills: arr(profile.skills),
          languages: arr(profile.languages),
          experienceLevel: str(profile.experience_level),
          yearsExperience: num(profile.years_experience),
          availability: str(profile.availability),
          githubUrl: str(profile.github_url),
          twitterUrl: str(profile.twitter_url),
          websiteUrl: str(profile.website_url),
          email: str(profile.email),
          portfolioCount: portfolioCount ?? 0,
          listingCount: listingCount ?? 0,
        }),
      );
    })();
    return () => {
      active = false;
    };
  }, [userId, refreshKey]);

  if (!result) return null;

  const incomplete = result.items.filter((i) => !i.complete);

  return (
    <section className="surface mb-10 p-5 sm:p-6" aria-label="Your profile completion">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Gauge className="size-4 text-lume" /> Your profile completion
          </div>
          <div className="mt-2 flex items-end gap-3">
            <span className="font-display text-4xl font-semibold leading-none">
              {result.percent}%
            </span>
            <span className="pb-0.5 text-sm text-muted-foreground">
              {result.percent >= 100 ? "Complete" : `${100 - result.percent}% to go`}
              {result.milestone ? ` · ${result.milestone.label}` : ""}
            </span>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
          {result.variant === "developer" ? "Developer checklist" : "Client checklist"}
        </span>
      </div>

      <div
        className="mt-4 h-3 w-full overflow-hidden rounded-full bg-lume/15"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={result.percent}
        aria-label="Profile completion"
      >
        <div
          className="h-full rounded-full bg-lume transition-[width] duration-700 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
          style={{ width: `${displayPercent}%` }}
        />
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <EyeOff className="mt-0.5 size-3.5 shrink-0" />
        Only you can see this score — it never appears on your public profile. A complete profile is
        not identity verification; verification is a separate process.
      </p>

      <div className="mt-5 grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {result.items.map((item) => (
          <div key={item.key} className="flex items-center gap-2 text-sm">
            {item.complete ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground/50" />
            )}
            <span className={item.complete ? "" : "text-muted-foreground"}>{item.label}</span>
            <span className="ml-auto text-xs text-muted-foreground">{item.weight}%</span>
          </div>
        ))}
      </div>

      {incomplete.length > 0 && (
        <div className="mt-5 border-t border-border/60 pt-4">
          <div className="text-sm font-medium">Improve your profile</div>
          <ul className="mt-2 space-y-1.5">
            {incomplete.slice(0, 4).map((item) => (
              <li key={item.key}>
                <a
                  href={`#${item.anchor}`}
                  className="group inline-flex items-center gap-1.5 text-sm text-lume hover:underline"
                >
                  {item.hint}
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
