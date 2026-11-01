import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Search,
  Store,
  LayoutDashboard,
  Wallet,
  User,
  Bell,
  LogOut,
  Globe,
  Activity,
  Menu,
  X,
  Compass,
  Users,
  Heart,
  MessageCircle,
  ShoppingBag,
  Sun,
  Moon,
  Monitor,
  Palette,
  Layers,
  LifeBuoy,
} from "lucide-react";
import { useCommerceCounts } from "@/lib/commerce";
import { fetchTotalUnread } from "@/lib/messages";
import { VELORALogo } from "./lume-logo";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { openCommandPalette, openCommandPaletteFromFocus } from "@/components/command-palette";
import {
  applyThemePreference,
  getSavedThemePreference,
  resolveTheme,
  subscribeToTheme,
  subscribeToThemePreference,
  type VeloraThemePreference,
} from "@/lib/theme";
import { AppearanceSettingsDialog } from "@/components/appearance-settings";
import { recordSearchQuery } from "@/lib/market";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

const NAV_LINKS = [
  { to: "/browse" as const, label: "Marketplace", icon: Compass },
  { to: "/browse" as const, label: "Categories", icon: Layers },
  { to: "/requests" as const, label: "Custom Projects", icon: Globe },
  { to: "/people" as const, label: "Developers", icon: Users },
  { to: "/sell" as const, label: "Become a Seller", icon: Store },
  { to: "/help" as const, label: "Help Center", icon: LifeBuoy },
];

export function TopNav() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [themePreference, setThemePreference] = useState<VeloraThemePreference>("dark");
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const counts = useCommerceCounts();

  useEffect(() => {
    const preference = getSavedThemePreference();
    applyThemePreference(preference, false);
    setThemePreference(preference);
    setTheme(resolveTheme(preference));
    const unsubscribeTheme = subscribeToTheme(setTheme);
    const unsubscribePreference = subscribeToThemePreference(setThemePreference);
    supabase.auth
      .getUser()
      .then(({ data }) => {
        setUserId(data.user?.id ?? null);
        setEmail(data.user?.email ?? null);
      })
      .catch(() => {
        setUserId(null);
        setEmail(null);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      setUserId(sess?.user?.id ?? null);
      setEmail(sess?.user?.email ?? null);
    });
    return () => {
      unsubscribeTheme();
      unsubscribePreference();
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!userId) {
      setUnread(0);
      return;
    }
    const load = () =>
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("read", false)
        .then(({ count }) => setUnread(count ?? 0));
    load();
    const ch = supabase
      .channel("notif-badge")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setDmUnread(0);
      return;
    }
    let cancelled = false;
    const load = () =>
      fetchTotalUnread(userId).then((n) => {
        if (!cancelled) setDmUnread(n);
      });
    load();
    const t = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [userId, pathname]);

  // Mobile menu search: a plain form that searches the marketplace. The
  // desktop search box is a trigger for the ⌘K command palette instead.
  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    void recordSearchQuery(query);
    navigate({
      to: "/browse",
      search: { q: query, kind: undefined, category: undefined, sort: undefined, page: undefined },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const iconBtn =
    "size-8 shrink-0 grid place-items-center rounded-full text-muted-foreground transition-all duration-300 hover:text-foreground hover:bg-accent/70 active:scale-95 sm:size-9";

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-3 sm:px-4 xl:gap-2">
        <Link to="/" className="shrink-0">
          <VELORALogo />
        </Link>

        <nav className="ml-4 hidden items-center gap-1 xl:ml-2 xl:gap-0 xl:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.label}
              to={l.to}
              search={l.to === "/browse" ? {} : undefined}
              className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm transition-colors xl:px-2 ${
                pathname.startsWith(l.to)
                  ? "bg-accent/50 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Palette trigger: a full text field while the link bar is hidden
            (below xl). Once the six text links appear (xl+) the header —
            capped at max-w-7xl at every larger width too — has no room
            left for the field next to the links and the icon cluster, so
            the trigger collapses to an icon-only button. The field was
            always just a palette trigger (it never took typed input), so
            nothing is lost: the palette still opens from here or via ⌘K. */}
        <div className="relative mx-auto hidden w-full min-w-0 max-w-md flex-1 sm:block xl:mx-0 xl:w-10 xl:flex-none">
          <button
            type="button"
            onClick={openCommandPalette}
            onFocus={openCommandPaletteFromFocus}
            title="Search (Ctrl/⌘ + K)"
            aria-label="Search"
            aria-keyshortcuts="Meta+K Control+K"
            className="relative h-10 w-full rounded-full border border-border/60 bg-muted/60 pl-10 pr-3 text-left text-sm text-muted-foreground/80 transition-colors hover:text-muted-foreground focus:border-lume/60 focus:outline-none xl:px-0"
          >
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground xl:left-1/2 xl:-translate-x-1/2" />
            <span className="block truncate pr-10 xl:hidden">
              Search products, tools, templates…
            </span>
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-border/70 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium lg:block xl:hidden">
              ⌘K
            </kbd>
          </button>
        </div>

        <nav className="ml-auto flex items-center gap-0 sm:gap-0.5 xl:gap-0">
          <Link to="/status" className={`${iconBtn} hidden lg:grid`} title="Status center">
            <Activity className="size-4" />
          </Link>
          <Link to="/dashboard" className={`${iconBtn} hidden sm:grid`} title="Dashboard">
            <LayoutDashboard className="size-4" />
          </Link>
          <Link to="/earnings" className={`${iconBtn} hidden lg:grid`} title="Earnings">
            <Wallet className="size-4" />
          </Link>
          <Link
            to="/wishlist"
            className={`${iconBtn} relative`}
            title="Wishlist"
            aria-label="Wishlist"
          >
            <Heart className="size-4" />
            {counts.wishlist > 0 && (
              <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-medium">
                {counts.wishlist}
              </span>
            )}
          </Link>
          <Link to="/cart" className={`${iconBtn} relative`} title="Cart" aria-label="Cart">
            <ShoppingBag className="size-4" />
            {counts.cart > 0 && (
              <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full lume-gradient px-1 text-[10px] font-medium text-white">
                {counts.cart}
              </span>
            )}
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={iconBtn}
                title="Theme"
                aria-label={`Theme: ${themePreference}${themePreference === "system" ? ` (currently ${theme})` : ""}`}
              >
                {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-2xl">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={themePreference}
                onValueChange={(value) => applyThemePreference(value as VeloraThemePreference)}
              >
                <DropdownMenuRadioItem value="light">
                  <Sun className="mr-2 size-4" /> Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <Moon className="mr-2 size-4" /> Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <Monitor className="mr-2 size-4" /> System
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setAppearanceOpen(true)}>
                <Palette className="mr-2 size-4" /> Appearance settings…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Link
            to="/messages"
            className={`${iconBtn} relative`}
            title="Messages"
            aria-label="Messages"
          >
            <MessageCircle className="size-4" />
            {dmUnread > 0 && (
              <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full lume-gradient px-1 text-[10px] font-medium text-white">
                {dmUnread > 99 ? "99+" : dmUnread}
              </span>
            )}
          </Link>
          <Link to="/notifications" className={`${iconBtn} relative`} title="Notifications">
            <Bell className="size-4" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full lume-gradient px-1 text-[10px] font-medium text-white">
                {unread}
              </span>
            )}
          </Link>

          {userId ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={iconBtn} aria-label="Account">
                  <User className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-2xl">
                <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
                  {email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/dashboard">Dashboard</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/marketplace-os">Marketplace OS</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/purchases">Purchases</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/wishlist">Wishlist</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/earnings">Earnings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/sell">New listing</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setAppearanceOpen(true)}>
                  <Palette className="mr-2 size-4" /> Appearance
                </DropdownMenuItem>
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            pathname !== "/auth" && (
              <Button
                asChild
                size="sm"
                className="ml-1 shrink-0 rounded-full lume-gradient text-white hover:opacity-90"
              >
                <Link to="/auth">Sign in</Link>
              </Button>
            )
          )}

          <button
            className={`${iconBtn} xl:hidden`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
          >
            {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </nav>
      </div>

      {menuOpen && (
        <div className="animate-fade border-t border-border/60 bg-background/95 px-4 py-4 backdrop-blur-xl xl:hidden">
          <form onSubmit={submitSearch} className="relative mb-3 sm:hidden">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products…"
              className="h-11 w-full rounded-2xl border border-border/60 bg-muted/60 pl-10 pr-3 text-sm focus:border-lume/60 focus:outline-none"
            />
          </form>
          <div className="grid gap-1">
            {!userId && pathname !== "/auth" && (
              <Link
                to="/auth"
                className="mb-2 flex items-center justify-center rounded-2xl lume-gradient px-3 py-3 text-sm font-semibold text-white"
              >
                Sign in / Create account
              </Link>
            )}
            {NAV_LINKS.concat([
              { to: "/messages" as any, label: "Messages", icon: MessageCircle },
              { to: "/dashboard" as any, label: "Dashboard", icon: LayoutDashboard },
              { to: "/earnings" as any, label: "Earnings", icon: Wallet },
              { to: "/status" as any, label: "Status", icon: Activity },
            ]).map((l) => (
              <Link
                key={l.label}
                to={l.to}
                search={l.to === "/browse" ? {} : undefined}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
              >
                <l.icon className="size-4" />
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <AppearanceSettingsDialog open={appearanceOpen} onOpenChange={setAppearanceOpen} />
    </header>
  );
}
