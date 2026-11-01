import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { VELORAAIChatbot } from "@/components/lume-ai-chatbot";
import { CommandPalette } from "@/components/command-palette";
import { readTheme, subscribeToTheme } from "@/lib/theme";
import { applyPreferences, readPreferences } from "@/lib/preferences";
import { loadAppearance } from "@/lib/appearance";
import { clearStandingCache, fetchMyStanding, type AccountStanding } from "@/lib/account-standing";
import { ShieldAlert } from "lucide-react";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold lume-text">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>

        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or may have been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md lume-gradient px-4 py-2 text-sm font-medium text-white"
          >
            Return home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ reset }: { error: unknown; reset: () => void }) {
  return (
    <div className="relative min-h-screen grid place-items-center px-4">
      <div className="relative w-full max-w-md text-center glass-panel rounded-3xl p-8">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          !
        </div>
        <h1 className="mt-5 text-2xl font-semibold">This page could not load</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Something interrupted this page. Try again, or return to the marketplace.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={reset}
            className="glow-btn rounded-xl lume-gradient px-5 py-2.5 text-sm font-semibold text-white"
          >
            Try again
          </button>
          <Link
            to="/"
            className="rounded-xl border border-border/70 bg-card/60 px-5 py-2.5 text-sm font-medium"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "NORDEVA Marketplace — Buy & sell premium digital products" },
      {
        name: "description",
        content:
          "NORDEVA Marketplace is where creators, developers and AI builders buy and sell software, websites, templates, source code and design assets.",
      },
      { property: "og:site_name", content: "NORDEVA Marketplace" },
      {
        property: "og:title",
        content: "NORDEVA Marketplace — Buy & sell premium digital products",
      },
      {
        property: "og:description",
        content:
          "A curated marketplace for AI tools, SaaS, websites, apps, templates and source code.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/og-image.svg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "/og-image.svg" },
      { name: "twitter:title", content: "NORDEVA Marketplace" },
      {
        name: "twitter:description",
        content:
          "A curated marketplace for AI tools, SaaS, websites, apps, templates and source code.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600;700&family=Sora:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{try{const p=localStorage.getItem("velora-theme");const t=p==="light"||p==="dark"?p:p==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):"dark";document.documentElement.classList.toggle("light",t==="light");document.documentElement.classList.toggle("dark",t==="dark");document.documentElement.style.colorScheme=t;}catch(_){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";}try{const a=JSON.parse(localStorage.getItem("velora-appearance")||"null");if(a){const r=document.documentElement;if(["titanium","premium-dark","classic-marketplace","modern-minimal","editorial-commerce","professional-neutral"].includes(a.preset))r.dataset.preset=a.preset;if(a.gridDensity==="compact"||a.gridDensity==="comfortable")r.dataset.density=a.gridDensity;if(a.contentWidth==="wide"||a.contentWidth==="standard")r.dataset.width=a.contentWidth;if(typeof a.accentHue==="number"&&a.accentHue>=0&&a.accentHue<=360){r.dataset.accentHue="true";r.style.setProperty("--accent-hue",String(a.accentHue));}}}catch(_){}try{const u=JSON.parse(localStorage.getItem("velora-preferences")||"null");if(u){const r=document.documentElement;if(u.fontScale==="large")r.style.fontSize="112.5%";if(u.radius==="sharp"||u.radius==="round")r.dataset.userRadius=u.radius;if(u.motion==="reduced")r.dataset.motion="reduced";if(u.density==="compact"||u.density==="comfortable")r.dataset.density=u.density;}}catch(_){}})();`,
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    // Read the theme after hydration as well as subscribing: child effects may
    // emit the initial theme event before this root effect is registered.
    setTheme(readTheme());
    return subscribeToTheme(setTheme);
  }, []);

  useEffect(() => {
    // Site-wide appearance (admin design settings): the bootstrap script has
    // already applied the cached copy; this fetches the canonical server copy
    // and applies it. Defaults are the current look, so SSR stays unchanged.
    void loadAppearance();
  }, []);

  useEffect(() => {
    // Per-user appearance preferences (this device only): the bootstrap has
    // already painted them; this syncs the module state and installs the
    // guard that re-asserts an explicit user density after the admin
    // appearance resolves (see src/lib/preferences.ts).
    applyPreferences(readPreferences());
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  // Suspension banner (M5): when the signed-in user's account standing is
  // suspended, show a slim site-wide notice. Signed-out visitors never
  // trigger the check, and the helper is failure-open, so a failed check
  // simply shows nothing.
  const [standing, setStanding] = useState<AccountStanding | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        if (alive) setStanding(null);
        return;
      }
      const result = await fetchMyStanding();
      if (alive) setStanding(result.suspended ? result : null);
    };
    void load();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearStandingCache();
        setStanding(null);
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        clearStandingCache();
        void load();
      }
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {standing?.suspended ? (
        <div
          role="alert"
          className="flex items-center justify-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-center text-xs font-medium text-red-600 dark:text-red-300"
        >
          <ShieldAlert className="size-4 shrink-0" />
          <span>
            Your account is suspended — {standing.reason?.trim() || "contact support"}. You can
            browse, but posting, messaging and payments are paused.
          </span>
        </div>
      ) : null}
      <Outlet />
      <VELORAAIChatbot />
      <CommandPalette />
      <Toaster theme={theme} />
    </QueryClientProvider>
  );
}
