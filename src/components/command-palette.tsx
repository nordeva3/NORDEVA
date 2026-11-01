import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BadgeCheck,
  Compass,
  Globe,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  MessageCircle,
  Package,
  Search,
  Store,
  Users,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Avatar } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { fetchSearchSuggestions, recordSearchQuery, type SearchSuggestion } from "@/lib/market";
import { formatMoney } from "@/lib/currencies";

const OPEN_EVENT = "velora:open-command-palette";

/**
 * When the palette closes, Radix returns focus to the element that opened
 * it. If that was the TopNav search trigger, its focus-open handler would
 * immediately reopen the palette — this timestamp suppresses that loop.
 */
let suppressFocusOpenUntil = 0;

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Focus-based opening (TopNav search trigger); ignored right after a close. */
export function openCommandPaletteFromFocus() {
  if (Date.now() < suppressFocusOpenUntil) return;
  openCommandPalette();
}

type CreatorHit = {
  id: string;
  display_name: string | null;
  username: string;
  avatar_url: string | null;
  verified: boolean | null;
};

type NavAction = {
  label: string;
  icon: typeof Compass;
  run: (navigate: ReturnType<typeof useNavigate>) => void;
  signedInOnly?: boolean;
};

const NAV_ACTIONS: NavAction[] = [
  {
    label: "Marketplace",
    icon: Compass,
    run: (navigate) => navigate({ to: "/browse", search: {} }),
  },
  {
    label: "Custom Projects",
    icon: Globe,
    run: (navigate) => navigate({ to: "/requests" }),
  },
  { label: "Developers", icon: Users, run: (navigate) => navigate({ to: "/people" }) },
  { label: "Sell", icon: Store, run: (navigate) => navigate({ to: "/sell" }) },
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    signedInOnly: true,
    run: (navigate) => navigate({ to: "/dashboard" }),
  },
  {
    label: "Messages",
    icon: MessageCircle,
    signedInOnly: true,
    run: (navigate) => navigate({ to: "/messages" }),
  },
  { label: "Help Center", icon: LifeBuoy, run: (navigate) => navigate({ to: "/help" }) },
];

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<SearchSuggestion[]>([]);
  const [creators, setCreators] = useState<CreatorHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const requestRef = useRef(0);

  // Cmd/Ctrl+K toggles the palette from anywhere; TopNav opens it via event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpenEvent = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, []);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null))
      .catch(() => setUserId(null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) =>
      setUserId(sess?.user?.id ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const term = query.trim();
  const termReady = term.length >= 2;

  // Debounced live search: products via the marketplace suggestion helper,
  // creators via public_profiles (same table the Developers page reads).
  useEffect(() => {
    if (!open || !termReady) {
      setProducts([]);
      setCreators([]);
      setSearching(false);
      setSearched(false);
      return;
    }
    const requestId = ++requestRef.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const clean = term.replace(/[%,()]/g, " ").trim();
      const [suggestions, creatorRows] = await Promise.all([
        fetchSearchSuggestions(term, 10).catch(() => [] as SearchSuggestion[]),
        clean.length >= 2
          ? supabase
              .from("public_profiles")
              .select("id,display_name,username,avatar_url,verified")
              .not("username", "is", null)
              .or(`display_name.ilike.%${clean}%,username.ilike.%${clean}%`)
              .order("verified", { ascending: false })
              .limit(5)
              .then(
                ({ data }) => (data ?? []) as CreatorHit[],
                () => [] as CreatorHit[],
              )
          : Promise.resolve([] as CreatorHit[]),
      ]);
      if (requestRef.current !== requestId) return;
      setProducts(
        suggestions.filter((s) => s.suggestion_type === "product" && s.listing_id).slice(0, 6),
      );
      setCreators(creatorRows.filter((c) => c.username));
      setSearching(false);
      setSearched(true);
    }, 180);
    return () => clearTimeout(t);
  }, [open, term, termReady]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      suppressFocusOpenUntil = Date.now() + 600;
      // Reset after the close animation so the next open starts clean.
      setTimeout(() => {
        setQuery("");
        setProducts([]);
        setCreators([]);
        setSearched(false);
      }, 150);
    }
  };

  const close = (fn: () => void) => () => {
    handleOpenChange(false);
    fn();
  };

  const searchMarketplace = close(() => {
    void recordSearchQuery(term);
    navigate({
      to: "/browse",
      search: { q: term, kind: undefined, category: undefined, sort: undefined, page: undefined },
    });
  });

  const visibleActions = useMemo(() => {
    const pool = NAV_ACTIONS.filter((a) => !a.signedInOnly || userId);
    if (!term) return pool;
    const needle = term.toLowerCase();
    return pool.filter((a) => a.label.toLowerCase().includes(needle));
  }, [term, userId]);

  const nothingFound =
    termReady && searched && !searching && products.length === 0 && creators.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="top-[10%] w-[calc(100vw-2rem)] max-w-lg translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 sm:top-[50%] sm:translate-y-[-50%]"
      >
        <DialogTitle className="sr-only">Search NORDEVA</DialogTitle>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput
            placeholder="Search products, creators…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[min(60vh,26rem)]">
            <CommandEmpty>No results found.</CommandEmpty>

            {termReady && (
              <CommandGroup heading="Search">
                <CommandItem value={`search:${term}`} onSelect={searchMarketplace}>
                  <Search className="text-muted-foreground" />
                  <span className="min-w-0 truncate">
                    Search the marketplace for <span className="font-medium">“{term}”</span>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}

            {searching && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Searching…
              </div>
            )}

            {nothingFound && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No products or creators match “{term}”. Press Enter to search the marketplace.
              </div>
            )}

            {products.length > 0 && (
              <CommandGroup heading="Products">
                {products.map((p) => (
                  <CommandItem
                    key={p.listing_id}
                    value={`product:${p.listing_id}`}
                    onSelect={close(() => {
                      void recordSearchQuery(p.label);
                      navigate({ to: "/listing/$id", params: { id: p.listing_id as string } });
                    })}
                  >
                    <Package className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{p.label}</span>
                    {p.price != null && p.currency && (
                      <span className="shrink-0 text-xs font-medium lume-text">
                        {formatMoney(p.price, p.currency)}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {creators.length > 0 && (
              <CommandGroup heading="Creators">
                {creators.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`creator:${c.username}`}
                    onSelect={close(() =>
                      navigate({ to: "/creator/$username", params: { username: c.username } }),
                    )}
                  >
                    <Avatar name={c.display_name ?? c.username} url={c.avatar_url} size={22} />
                    <span className="min-w-0 flex-1 truncate">
                      {c.display_name ?? c.username}
                      <span className="ml-2 text-xs text-muted-foreground">@{c.username}</span>
                    </span>
                    {c.verified && <BadgeCheck className="shrink-0 text-lume" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {visibleActions.length > 0 && (
              <>
                {(termReady || products.length > 0 || creators.length > 0) && <CommandSeparator />}
                <CommandGroup heading="Go to">
                  {visibleActions.map((a) => (
                    <CommandItem
                      key={a.label}
                      value={`nav:${a.label}`}
                      onSelect={close(() => a.run(navigate))}
                    >
                      <a.icon className="text-muted-foreground" />
                      <span>{a.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
