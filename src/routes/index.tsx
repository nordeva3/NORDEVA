import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  AppWindow,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  Box,
  Briefcase,
  Check,
  Clapperboard,
  ClipboardList,
  Code2,
  Compass,
  Globe,
  GraduationCap,
  Image as ImageIcon,
  Layers,
  LayoutTemplate,
  Lock,
  Mail,
  Megaphone,
  Minus,
  Music,
  Package,
  Palette,
  PenTool,
  Plus,
  Puzzle,
  Quote,
  Rocket,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Star,
  Store,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { TopNav } from "@/components/top-nav";
import { ListingCard } from "@/components/listing-card";
import { Avatar, EmptyState, Reveal, SectionHeading } from "@/components/ui-kit";
import {
  fetchCategoryTiles,
  fetchFeaturedDevelopers,
  fetchHomeSections,
  fetchTestimonials,
  fetchTopCreators,
  type CardListing,
  type CategoryTile,
} from "@/lib/market";
import {
  getCurrentAppearance,
  subscribeToAppearance,
  type AppearanceConfig,
  type PromoBannerConfig,
} from "@/lib/appearance";
import { formatMoney } from "@/lib/currencies";
import { PROJECT_PACKAGES } from "@/lib/project-requests";
import { VELORAMark } from "@/components/lume-logo";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { subscribeNewsletter } from "@/lib/newsletter.functions";

const homeQO = queryOptions({ queryKey: ["home-sections"], queryFn: fetchHomeSections });
const creatorsQO = queryOptions({ queryKey: ["top-creators"], queryFn: () => fetchTopCreators(6) });
const developersQO = queryOptions({
  queryKey: ["featured-developers"],
  queryFn: () => fetchFeaturedDevelopers(6),
});
const testimonialsQO = queryOptions({
  queryKey: ["testimonials"],
  queryFn: () => fetchTestimonials(3),
});
const categoryTilesQO = queryOptions({
  queryKey: ["category-tiles"],
  queryFn: () => fetchCategoryTiles(12),
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NORDEVA Marketplace — Premium digital products for builders" },
      {
        name: "description",
        content:
          "Buy and sell AI tools, SaaS, websites, apps, templates, source code and design assets on NORDEVA Marketplace. Instant delivery, a flat 15% fee, every listing reviewed.",
      },
      { property: "og:title", content: "NORDEVA Marketplace — Premium digital products" },
      {
        property: "og:description",
        content:
          "A curated marketplace for AI tools, SaaS, websites, apps, templates and source code. Instant delivery, flat 15% fee.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),

  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(homeQO),
      context.queryClient.ensureQueryData(creatorsQO),
      context.queryClient.ensureQueryData(developersQO),
      context.queryClient.ensureQueryData(testimonialsQO),
      context.queryClient.ensureQueryData(categoryTilesQO),
    ]);
  },

  errorComponent: ({ error }) => (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-3xl px-4 py-24 text-center" role="alert">
        <h1 className="text-2xl font-semibold">We couldn't load the marketplace</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Something went wrong"}
        </p>
      </div>
    </div>
  ),
  component: Home,
});

const FAQS = [
  {
    q: "What can I sell on NORDEVA Marketplace?",
    a: "AI tools, SaaS starters, websites, mobile apps, templates, source code, UI kits, automation tools, APIs and design assets. Anything you own the rights to and can hand over in full.",
  },
  {
    q: "How much does NORDEVA take?",
    a: "A flat 15% of each sale. There are no listing fees, no monthly fees and no hidden charges. You keep 85%.",
  },
  {
    q: "How fast is review?",
    a: "Listings are checked by a human admin before they go live. NORDEVA AI is available as a website-only help assistant and does not approve listings.",
  },
  {
    q: "How do buyers receive a product?",
    a: "Instantly. The moment payment clears, the buyer gets a signed, expiring download link plus any demo and documentation links you added.",
  },
  {
    q: "How do I get paid?",
    a: "Open Earnings, request a withdrawal, and choose UPI or bank transfer. Payouts are released within 1–2 weeks of the request.",
  },
];

const VALUES = [
  {
    icon: Zap,
    title: "Instant delivery",
    body: "Signed, expiring download links the second payment clears.",
  },
  {
    icon: Lock,
    title: "Your code stays yours",
    body: "NORDEVA never reads, runs or resells your source.",
  },
  {
    icon: Wallet,
    title: "Seller earnings",
    body: "Track sales, available balances, payout requests and marketplace operations from one seller workspace.",
  },
  {
    icon: BadgeCheck,
    title: "Every listing reviewed",
    body: "Every listing enters the moderation workflow before it goes live; production deployments can add an external malware scanner.",
  },
];

/** Current site appearance (admin design settings). Starts from whatever
 * the root bootstrap already applied, then follows live changes. */
function useAppearance(): AppearanceConfig {
  const [config, setConfig] = useState<AppearanceConfig>(() => getCurrentAppearance());
  useEffect(() => subscribeToAppearance(setConfig), []);
  return config;
}

const CATEGORY_ICON_RULES: { match: RegExp; icon: typeof Layers }[] = [
  { match: /word ?press/, icon: Globe },
  { match: /php|script|developer|code|dev /, icon: Code2 },
  { match: /html|template|website|landing/, icon: LayoutTemplate },
  { match: /mobile|app/, icon: Smartphone },
  { match: /plugin|extension|add-?on/, icon: Puzzle },
  { match: /ui|ux|design/, icon: PenTool },
  { match: /graphic|photo|image|illustration/, icon: ImageIcon },
  { match: /theme/, icon: Palette },
  { match: /3d|game|asset/, icon: Box },
  { match: /audio|music|sound/, icon: Music },
  { match: /video|motion|animation/, icon: Clapperboard },
  { match: /ebook|e-book|document|book/, icon: BookOpen },
  { match: /course|education|learn/, icon: GraduationCap },
  { match: /marketing|seo|social/, icon: Megaphone },
  { match: /business|finance|productivity/, icon: Briefcase },
  { match: /ai|automation/, icon: Sparkles },
  { match: /software|tool/, icon: AppWindow },
];

function categoryIcon(name: string): typeof Layers {
  const n = name.toLowerCase();
  for (const rule of CATEGORY_ICON_RULES) if (rule.match.test(n)) return rule.icon;
  return Layers;
}

function Home() {
  const { data } = useSuspenseQuery(homeQO);
  const { data: creators } = useSuspenseQuery(creatorsQO);
  const { data: developers } = useSuspenseQuery(developersQO);
  const { data: testimonials } = useSuspenseQuery(testimonialsQO);
  const { data: categoryTiles } = useSuspenseQuery(categoryTilesQO);
  const appearance = useAppearance();
  const hasProducts = data.latest.length > 0;
  const categoryCounts = new Map(
    data.categories.map((c) => [c.name.toLowerCase(), c.count] as const),
  );
  const featuredIds = new Set(data.featured.map((l) => l.id));
  const collageListings = [
    ...data.featured,
    ...data.latest.filter((l) => !featuredIds.has(l.id)),
  ].slice(0, 4);

  return (
    <div className="min-h-screen">
      <TopNav />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-accent/20 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative mx-auto w-full max-w-[var(--content-width)] px-4 pb-16 pt-14 sm:pt-20 lg:pb-24">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] lg:gap-14">
            {/* Left — copy, search, actions */}
            <div className="min-w-0">
              <div className="inline-flex animate-rise items-center gap-2 rounded-full border border-lume/25 bg-lume/[0.08] px-3.5 py-1.5 text-xs text-lume backdrop-blur">
                <Sparkles className="size-3.5" />A marketplace for people who make things
              </div>

              <h1
                className="mt-7 animate-rise font-display text-[2.6rem] font-semibold leading-[1.03] sm:text-6xl"
                style={{ animationDelay: "70ms" }}
              >
                Good work deserves
                <br />
                <span className="lume-text">a better storefront.</span>
              </h1>
              <p
                className="mt-6 max-w-xl animate-rise text-sm leading-relaxed text-muted-foreground sm:text-base"
                style={{ animationDelay: "150ms" }}
              >
                Discover useful software, thoughtful templates and digital tools made by independent
                creators — delivered securely, with straightforward USD pricing.
              </p>

              <div className="mt-9 animate-rise" style={{ animationDelay: "220ms" }}>
                <HeroSearch />
              </div>

              <div
                className="mt-6 flex animate-rise flex-col gap-3 sm:flex-row"
                style={{ animationDelay: "280ms" }}
              >
                <Link
                  to="/browse"
                  search={{}}
                  className="glow-btn inline-flex items-center justify-center gap-2 rounded-2xl lume-gradient px-7 py-3.5 text-sm font-semibold text-white"
                >
                  <Compass className="size-4" /> Explore marketplace
                </Link>
                <Link
                  to="/requests"
                  className="glow-btn inline-flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card/60 px-7 py-3.5 text-sm font-medium backdrop-blur"
                >
                  <ClipboardList className="size-4" /> Start a project
                </Link>
              </div>

              <div
                className="mt-9 flex animate-rise flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground"
                style={{ animationDelay: "340ms" }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5 text-lume" /> Independent creators
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-lume" /> Secure checkout
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Wallet className="size-3.5 text-lume" /> Straightforward USD pricing
                </span>
                <Link to="/sell" className="font-medium text-lume hover:opacity-80">
                  Selling something? List it →
                </Link>
              </div>
            </div>

            {/* Right — live collage / branded composition */}
            <Reveal delay={140} className="min-w-0">
              <HeroCollage
                listings={collageListings}
                tiles={categoryTiles}
                counts={categoryCounts}
              />
            </Reveal>
          </div>
        </div>
      </section>

      {/* PROMO BANNER */}
      <PromoBanner config={appearance.promoBanner} />

      {/* FEATURED */}
      {data.featured.length > 0 && (
        <Section>
          <SectionHeading
            eyebrow="Featured"
            title="A few good finds"
            subtitle="Ranked from real reviews and real sales — never editorial filler."
            action={
              <Link to="/browse" search={{}} className="hidden text-sm text-lume sm:block">
                View all →
              </Link>
            }
          />
          <div className="grid gap-[var(--card-gap)] sm:grid-cols-2 lg:grid-cols-3">
            {data.featured.map((l, i) => (
              <Reveal key={l.id} delay={i * 80}>
                <ListingCard l={l} variant={appearance.cardVariant} />
              </Reveal>
            ))}
          </div>
        </Section>
      )}

      {/* TRENDING */}
      <Section>
        <SectionHeading
          eyebrow="Trending"
          title="Most downloaded right now"
          action={
            <Link
              to="/browse"
              search={{ sort: "trending" }}
              className="hidden text-sm text-lume sm:block"
            >
              See all →
            </Link>
          }
        />
        {data.trending.some((t) => t.sales_count > 0) ? (
          <div className="grid gap-[var(--card-gap)] sm:grid-cols-2 lg:grid-cols-4">
            {data.trending
              .filter((t) => t.sales_count > 0)
              .slice(0, 4)
              .map((l, i) => (
                <Reveal key={l.id} delay={i * 70}>
                  <ListingCard l={l} variant={appearance.cardVariant} />
                </Reveal>
              ))}
          </div>
        ) : (
          <EmptyState
            icon={<Zap className="size-5" />}
            title="Nothing trending yet"
            body="Trending is driven purely by completed purchases. As soon as products start selling, they show up here."
          />
        )}
      </Section>

      {/* BESTSELLING */}
      {data.bestselling.length > 0 && (
        <Section>
          <SectionHeading
            eyebrow="Bestsellers"
            title="Bestselling products"
            subtitle="Ranked by completed sales, all time."
            action={
              <Link
                to="/browse"
                search={{ sort: "trending" }}
                className="hidden text-sm text-lume sm:block"
              >
                See all →
              </Link>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {data.bestselling.map((l, i) => (
              <Reveal key={l.id} delay={i * 60}>
                <ListingCard l={l} variant="horizontal" />
              </Reveal>
            ))}
          </div>
        </Section>
      )}

      {/* NEW RELEASES */}
      <Section>
        <SectionHeading
          eyebrow="New releases"
          title="Freshly approved"
          action={
            <Link
              to="/browse"
              search={{ sort: "new" }}
              className="hidden text-sm text-lume sm:block"
            >
              See all →
            </Link>
          }
        />
        {hasProducts ? (
          <div className="grid gap-[var(--card-gap)] sm:grid-cols-2 lg:grid-cols-4">
            {data.latest.slice(0, 8).map((l, i) => (
              <Reveal key={l.id} delay={i * 60}>
                <ListingCard l={l} variant={appearance.cardVariant} />
              </Reveal>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Package className="size-5" />}
            title="No releases yet"
            body="Approved listings appear here the moment they pass review."
          />
        )}
      </Section>

      {/* CATEGORIES */}
      {categoryTiles.length > 0 && (
        <Section>
          <SectionHeading
            eyebrow="Categories"
            title="Browse by what you need"
            subtitle="From WordPress themes to full software — every category is stocked by independent creators."
            action={
              <Link to="/browse" search={{}} className="hidden text-sm text-lume sm:block">
                View all →
              </Link>
            }
          />
          <div className="grid gap-[var(--card-gap)] sm:grid-cols-2 lg:grid-cols-4">
            {categoryTiles.slice(0, 7).map((tile, i) => {
              const Icon = categoryIcon(tile.name);
              const count = categoryCounts.get(tile.name.toLowerCase()) ?? 0;
              const first = i === 0;
              return (
                <Reveal key={tile.name} delay={i * 60} className={first ? "sm:col-span-2" : ""}>
                  <Link
                    to="/browse"
                    search={{ category: tile.name }}
                    className="lift surface flex h-full flex-col justify-between p-6"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <Icon className={first ? "size-8 text-lume" : "size-6 text-lume"} />
                      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                    </span>
                    <span className="mt-10 block">
                      <span className={`block truncate font-medium ${first ? "text-lg" : ""}`}>
                        {tile.name}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {count > 0
                          ? `${count} ${count === 1 ? "product" : "products"}`
                          : "Browse the collection"}
                      </span>
                    </span>
                  </Link>
                </Reveal>
              );
            })}
            <Reveal delay={7 * 60}>
              <Link
                to="/browse"
                search={{ kind: "software" }}
                className="lift surface flex h-full flex-col justify-between p-6"
              >
                <span className="flex items-start justify-between gap-3">
                  <Code2 className="size-6 text-lume" />
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                </span>
                <span className="mt-10 block">
                  <span className="block font-medium">Software & code</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Apps, tools, scripts, SaaS starters
                  </span>
                </span>
              </Link>
            </Reveal>
          </div>
        </Section>
      )}

      {/* TOP CREATORS */}
      <Section>
        <SectionHeading
          eyebrow="Creators"
          title="People building on NORDEVA"
          subtitle="Ranked by published products and followers."
          action={
            <Link to="/people" className="hidden text-sm text-lume sm:block">
              View all →
            </Link>
          }
        />
        {creators.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creators.map((c, i) => (
              <Reveal key={c.id} delay={i * 70}>
                <Link
                  to="/creator/$username"
                  params={{ username: c.username ?? c.id }}
                  className="lift surface flex items-center gap-4 p-5"
                >
                  <Avatar name={c.display_name ?? c.username} url={c.avatar_url} size={46} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {c.display_name ?? c.username ?? "Creator"}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{c.products} products</span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" /> {c.followers}
                      </span>
                      {c.rating_avg != null && (
                        <span className="inline-flex items-center gap-1">
                          <Star className="size-3 fill-gold text-gold" /> {c.rating_avg.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Users className="size-5" />}
            title="No creators to show yet"
            body="Creator profiles appear once a seller has at least one approved product."
          />
        )}
      </Section>

      {/* FEATURED DEVELOPERS */}
      {developers.length >= 2 && (
        <Section>
          <SectionHeading
            eyebrow="Developers"
            title="Featured developers"
            subtitle="Independent developers you can hire for a custom website — or whose products you can buy today."
            action={
              <Link to="/people" className="hidden text-sm text-lume sm:block">
                Meet everyone →
              </Link>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {developers.map((d, i) => (
              <Reveal key={d.id} delay={i * 70}>
                <Link
                  to="/creator/$username"
                  params={{ username: d.username ?? d.id }}
                  className="lift surface flex h-full flex-col p-5"
                >
                  <span className="flex items-center gap-3">
                    <Avatar name={d.display_name ?? d.username} url={d.avatar_url} size={46} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 truncate font-medium">
                        {d.display_name ?? d.username ?? "Developer"}
                        {d.verified && (
                          <BadgeCheck
                            className="size-4 shrink-0 text-sky-500"
                            aria-label="Verified"
                          />
                        )}
                      </span>
                      {d.headline && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {d.headline}
                        </span>
                      )}
                    </span>
                  </span>
                  {d.skills.length > 0 && (
                    <span className="mt-4 flex flex-wrap gap-1.5">
                      {d.skills.slice(0, 3).map((s) => (
                        <span
                          key={s}
                          className="rounded-full border border-border/60 bg-accent/25 px-2 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {s}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="mt-4 flex items-center gap-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                    <span>{d.listings} products</span>
                    <span>
                      {d.projects} website {d.projects === 1 ? "project" : "projects"}
                    </span>
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </Section>
      )}

      {/* HOW IT WORKS */}
      <Section>
        <SectionHeading
          eyebrow="How NORDEVA works"
          title="Two ways to get your website"
          subtitle="Buy something ready-made, or hire a developer to build it for you — both live on the same account."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: ShoppingBag,
              step: "1",
              title: "Buy a ready-made product",
              body: "Browse software, templates and full websites in the marketplace. Pay securely and your download arrives instantly as a signed, private link.",
            },
            {
              icon: ClipboardList,
              step: "2",
              title: "Or post a website project",
              body: "Describe the site you need and pick a package range. Developers send proposals with prices and timelines — you choose who to work with.",
            },
            {
              icon: Rocket,
              step: "3",
              title: "Build together, then launch",
              body: "Chat in the private project workspace, follow milestones, review previews and approve the final delivery. Developers keep 85% of the agreed price — NORDEVA's fee is a flat 15%.",
            },
          ].map((s, i) => (
            <Reveal key={s.step} delay={i * 80}>
              <div className="surface h-full p-6">
                <div className="flex items-center justify-between">
                  <s.icon className="size-5 text-lume" />
                  <span className="text-xs font-medium text-muted-foreground">Step {s.step}</span>
                </div>
                <div className="mt-5 font-medium">{s.title}</div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* CUSTOM WEBSITE DEVELOPMENT */}
      <Section>
        <SectionHeading
          eyebrow="Custom website projects"
          title="Need a website built for you?"
          subtitle="Post a request, compare developer proposals, and agree the final price together before any work begins."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {PROJECT_PACKAGES.map((p, i) => (
            <Reveal key={p.id} delay={i * 80}>
              <div className="surface flex h-full flex-col p-6">
                {p.id === "simple" ? (
                  <Globe className="size-5 text-lume" />
                ) : p.id === "advanced" ? (
                  <LayoutTemplate className="size-5 text-lume" />
                ) : (
                  <Rocket className="size-5 text-lume" />
                )}
                <div className="mt-5 font-medium">{p.label}</div>
                <div className="mt-1 text-sm">
                  <span className="lume-text font-semibold">
                    ${p.min}–${p.max}
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">starting range</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{p.blurb}</p>
                <ul className="mt-4 space-y-1.5">
                  {p.suitableFor.slice(0, 3).map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-lume" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-[1.5rem] border border-border/60 bg-card/50 p-6 sm:flex-row sm:items-center">
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            These are starting ranges, not fixed prices. You and your developer agree the final
            scope and price first — then work starts in a private workspace with milestones,
            previews and revisions.
          </p>
          <Link
            to="/requests"
            className="glow-btn inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl lume-gradient px-6 py-3 text-sm font-semibold text-white"
          >
            Post a project request <ArrowRight className="size-4" />
          </Link>
        </div>
      </Section>

      {/* VALUES */}
      <Section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map((v, i) => (
            <Reveal key={v.title} delay={i * 70}>
              <div className="surface h-full p-6">
                <v.icon className="size-5 text-lume" />
                <div className="mt-5 font-medium">{v.title}</div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{v.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* TESTIMONIALS — real verified reviews only */}
      <Section>
        <SectionHeading
          eyebrow="What buyers say"
          title="Straight from verified purchases"
          subtitle="Every quote below is a real review left by someone who bought the product."
        />
        {testimonials.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t, i) => (
              <Reveal key={t.id} delay={i * 80}>
                <figure className="surface flex h-full flex-col p-6">
                  <Quote className="size-5 text-lume/70" />
                  <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-foreground/90">
                    {t.body}
                  </blockquote>
                  <figcaption className="mt-6 flex items-center gap-3 border-t border-border/60 pt-4">
                    <Avatar
                      name={t.author?.display_name ?? t.author?.username}
                      url={t.author?.avatar_url ?? null}
                      size={34}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">
                        {t.author?.display_name ?? t.author?.username ?? "Verified buyer"}
                      </div>
                      {t.listing && (
                        <Link
                          to="/listing/$id"
                          params={{ id: t.listing.id }}
                          className="truncate text-[11px] text-muted-foreground hover:text-lume"
                        >
                          on {t.listing.title}
                        </Link>
                      )}
                    </div>
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-gold">
                      <Star className="size-3 fill-gold" /> {t.rating}
                    </span>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Quote className="size-5" />}
            title="No reviews yet"
            body="Testimonials only ever come from verified purchases, so this section stays empty until the first buyer leaves a review."
          />
        )}
      </Section>

      {/* FAQ */}
      <Section>
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />
        <div className="mx-auto max-w-3xl divide-y divide-border/60 overflow-hidden rounded-[1.5rem] border border-border/60 bg-card/50">
          {FAQS.map((f) => (
            <FaqRow key={f.q} q={f.q} a={f.a} />
          ))}
        </div>
      </Section>

      {/* SELL OR BUILD CTA */}
      <Section>
        <div className="grid gap-4 md:grid-cols-2">
          <Reveal>
            <div className="surface flex h-full flex-col p-7">
              <Store className="size-5 text-lume" />
              <h2 className="mt-5 text-xl font-semibold">Sell digital products</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                Publish software, templates, sites and design assets once, and sell them around the
                clock. No listing fees — you keep 85% of every sale.
              </p>
              <Link
                to="/sell"
                className="glow-btn mt-6 inline-flex w-fit items-center gap-2 rounded-2xl lume-gradient px-6 py-3 text-sm font-semibold text-white"
              >
                Start selling <ArrowRight className="size-4" />
              </Link>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="surface flex h-full flex-col p-7">
              <Code2 className="size-5 text-lume" />
              <h2 className="mt-5 text-xl font-semibold">Offer website development</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                Browse open project requests, send proposals with your price and timeline, and build
                in a private workspace with milestones and delivery reviews.
              </p>
              <Link
                to="/requests"
                className="glow-btn mt-6 inline-flex w-fit items-center gap-2 rounded-2xl border border-border/70 bg-card/60 px-6 py-3 text-sm font-medium"
              >
                Browse open requests <ArrowRight className="size-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* CTA + NEWSLETTER */}
      <section className="mx-auto w-full max-w-[var(--content-width)] px-4 pb-20">
        <Reveal>
          <div className="glass-panel relative overflow-hidden rounded-[1.75rem] px-6 py-14 text-center sm:px-16">
            <div className="pointer-events-none absolute inset-0 starfield animate-drift opacity-30" />
            <div className="relative">
              <h2 className="text-2xl font-semibold sm:text-4xl">
                Ready to sell your work on <span className="lume-text">NORDEVA</span>?
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-sm text-muted-foreground">
                Upload your product once, then wait for human admin moderation before it goes live.
              </p>
              <Link
                to="/sell"
                className="glow-btn mt-8 inline-flex items-center justify-center gap-2 rounded-2xl lume-gradient px-7 py-3.5 text-sm font-semibold text-white"
              >
                Create a listing <ArrowRight className="size-4" />
              </Link>
              <NewsletterForm />
            </div>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}

function HeroSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = query.trim();
        navigate({ to: "/browse", search: q ? { q } : {} });
      }}
      className="flex w-full max-w-xl items-center gap-2 rounded-2xl border border-border/70 bg-card/70 p-1.5 backdrop-blur transition-colors focus-within:border-lume/60"
    >
      <Search className="ml-2.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <label className="sr-only" htmlFor="hero-search">
        Search the marketplace
      </label>
      <input
        id="hero-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search products, tools, templates…"
        className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground/60"
      />
      <button
        type="submit"
        className="glow-btn shrink-0 rounded-xl lume-gradient px-5 py-2.5 text-sm font-semibold text-white"
      >
        Search
      </button>
    </form>
  );
}

function HeroCollage({
  listings,
  tiles,
  counts,
}: {
  listings: CardListing[];
  tiles: CategoryTile[];
  counts: Map<string, number>;
}) {
  if (listings.length > 0) {
    const shown = listings.length >= 3 ? listings.slice(0, 3) : listings;
    return (
      <div className="glass-panel overflow-hidden rounded-[1.75rem] p-2.5 sm:p-3">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            <span className="size-1.5 animate-pulse-soft rounded-full bg-lume" /> Live on NORDEVA
          </span>
          <Link
            to="/browse"
            search={{}}
            className="text-[11px] text-lume transition-opacity hover:opacity-80"
          >
            View all →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          {shown.map((l, i) => (
            <Link
              key={l.id}
              to="/listing/$id"
              params={{ id: l.id }}
              className={`group relative block overflow-hidden rounded-2xl bg-muted ${
                i === 0 || shown.length === 2 ? "col-span-2 aspect-[16/8]" : "aspect-[16/10]"
              }`}
            >
              {l.cover_url ? (
                <img
                  src={l.cover_url}
                  alt={l.title}
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover transition-transform [transition-duration:var(--reveal-duration)] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05]"
                />
              ) : (
                <span className="absolute inset-0 lume-gradient opacity-25" aria-hidden="true" />
              )}
              <span
                className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent"
                aria-hidden="true"
              />
              {i === 0 && l.category && (
                <span className="absolute left-3 top-3 rounded-full border border-white/25 bg-black/45 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-white backdrop-blur">
                  {l.category}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">{l.title}</span>
                  {l.seller && (
                    <span className="mt-0.5 block truncate text-[11px] text-white/75">
                      by {l.seller.display_name ?? l.seller.username ?? "Seller"}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm font-semibold text-white">
                  {formatMoney(l.price, l.currency)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  // No live products yet: a branded composition built from the real custom
  // project packages and the real category taxonomy — never fake products.
  return (
    <div className="glass-panel relative overflow-hidden rounded-[1.75rem] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-lume/25 bg-lume/[0.08] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-lume">
          <ClipboardList className="size-3.5" /> Custom website projects
        </span>
        <Link to="/requests" className="shrink-0 text-[11px] text-lume hover:opacity-80">
          Post a project →
        </Link>
      </div>
      <h2 className="mt-5 font-display text-2xl font-semibold leading-snug">
        Need a website built for you?
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Post a request, compare proposals from independent developers, and agree the final price
        together before work begins.
      </p>
      <div className="mt-5 space-y-2.5">
        {PROJECT_PACKAGES.map((p) => (
          <Link
            key={p.id}
            to="/requests"
            className="lift flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card/60 px-4 py-3"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{p.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{p.blurb}</span>
            </span>
            <span className="shrink-0 text-sm font-semibold lume-text">
              ${p.min}–${p.max}
            </span>
          </Link>
        ))}
      </div>
      {tiles.length > 0 && (
        <div className="mt-6 border-t border-border/60 pt-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Or explore the marketplace
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {tiles.slice(0, 4).map((tile) => {
              const Icon = categoryIcon(tile.name);
              const count = counts.get(tile.name.toLowerCase()) ?? 0;
              return (
                <Link
                  key={tile.name}
                  to="/browse"
                  search={{ category: tile.name }}
                  className="lift flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/60 px-3 py-2.5"
                >
                  <Icon className="size-4 shrink-0 text-lume" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{tile.name}</span>
                  {count > 0 && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">{count}</span>
                  )}
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PromoBanner({ config }: { config: PromoBannerConfig }) {
  if (!config.enabled || !config.heading) return null;

  const ctaClass =
    "glow-btn inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl lume-gradient px-6 py-3 text-sm font-semibold text-white";
  const cta =
    config.ctaLabel && config.ctaHref ? (
      config.ctaHref.startsWith("/") ? (
        <Link to={config.ctaHref} className={ctaClass}>
          {config.ctaLabel} <ArrowRight className="size-4" />
        </Link>
      ) : (
        <a href={config.ctaHref} target="_blank" rel="noreferrer" className={ctaClass}>
          {config.ctaLabel} <ArrowRight className="size-4" />
        </a>
      )
    ) : null;

  const copy = (
    <div className="min-w-0 max-w-2xl">
      {config.label && (
        <span className="inline-flex items-center rounded-full border border-lume/30 bg-lume/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-lume">
          {config.label}
        </span>
      )}
      <h2 className="mt-3 font-display text-2xl font-semibold leading-snug sm:text-3xl">
        {config.heading}
      </h2>
      {config.description && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{config.description}</p>
      )}
    </div>
  );

  if (config.bg === "image" && config.imageUrl) {
    return (
      <section className="mx-auto w-full max-w-[var(--content-width)] px-4 pb-6">
        <div className="relative overflow-hidden rounded-[1.75rem] border border-border/60">
          <img
            src={config.imageUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
          <div className="absolute inset-0 bg-background/80" aria-hidden="true" />
          <div className="relative flex flex-col gap-5 px-6 py-8 sm:px-10 sm:py-10 lg:flex-row lg:items-center lg:justify-between">
            {copy}
            {cta}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-[var(--content-width)] px-4 pb-6">
      <div className="flex flex-col gap-5 rounded-[1.75rem] border border-lume/25 bg-lume/[0.07] px-6 py-8 sm:px-10 lg:flex-row lg:items-center lg:justify-between">
        {copy}
        {cta}
      </div>
    </section>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-muted/30 sm:px-7"
      >
        <span className="flex-1 text-sm font-medium">{q}</span>
        {open ? (
          <Minus className="size-4 shrink-0 text-lume" />
        ) : (
          <Plus className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <p className="animate-fade px-5 pb-5 text-sm leading-relaxed text-muted-foreground sm:px-7">
          {a}
        </p>
      )}
    </div>
  );
}

function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const subscribe = useServerFn(subscribeNewsletter);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const clean = email.trim().toLowerCase();
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean);
        if (!ok) {
          toast.error("Enter a valid email address");
          return;
        }
        setBusy(true);
        try {
          const result = await subscribe({ data: { email: clean } });
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          setEmail("");
          toast.success("You're on the list — we'll email you when new drops land.");
        } catch {
          toast.error("Could not subscribe right now. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
      className="mx-auto mt-10 flex w-full max-w-md flex-col gap-2 sm:flex-row"
    >
      <label className="sr-only" htmlFor="newsletter-email">
        Email address
      </label>
      <div className="relative flex-1">
        <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="newsletter-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@studio.com"
          className="w-full rounded-2xl border border-border/70 bg-background/60 py-3 pl-10 pr-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-lume/60"
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="glow-btn rounded-2xl border border-lume/40 bg-lume/10 px-5 py-3 text-sm font-medium text-lume disabled:opacity-60"
      >
        {busy ? "Joining…" : "Keep me posted"}
      </button>
    </form>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-card/30">
      <div className="mx-auto grid w-full max-w-[var(--content-width)] gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <span className="inline-flex items-center gap-2.5">
            <VELORAMark size={22} />
            <span className="font-display text-base font-semibold">NORDEVA Marketplace</span>
          </span>
          <p className="mt-4 max-w-xs text-xs leading-relaxed text-muted-foreground">
            A curated marketplace for AI tools, SaaS, websites, apps, templates and source code —
            built for people who ship.
          </p>
        </div>
        <FooterCol
          title="Marketplace"
          links={[
            { to: "/browse", label: "Browse all", search: {} },
            { to: "/browse", label: "Software", search: { kind: "software" } },
            { to: "/browse", label: "Websites", search: { kind: "website" } },
            { to: "/browse", label: "Trending", search: { sort: "trending" } },
            { to: "/browse", label: "New releases", search: { sort: "new" } },
          ]}
        />
        <FooterCol
          title="Custom Projects"
          links={[
            { to: "/requests", label: "Post a project" },
            { to: "/requests", label: "Browse requests" },
            { to: "/requests", label: "Website packages" },
            { to: "/help", label: "How projects work" },
          ]}
        />
        <FooterCol
          title="Developers"
          links={[
            { to: "/people", label: "Find developers" },
            { to: "/sell", label: "Become a Seller" },
            { to: "/requests", label: "Offer development" },
            { to: "/dashboard", label: "Dashboard" },
            { to: "/earnings", label: "Earnings" },
          ]}
        />
        <FooterCol
          title="Support"
          links={[
            { to: "/help", label: "Help Center" },
            { to: "/terms", label: "Terms" },
            { to: "/privacy", label: "Privacy" },
            { to: "/refunds", label: "Refunds" },
            { to: "/status", label: "Status" },
          ]}
        />
      </div>
      <div className="border-t border-border/60 py-6">
        <div className="mx-auto flex w-full max-w-[var(--content-width)] flex-col items-center gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} NORDEVA Marketplace. All rights reserved.</span>
          <span>Flat 15% fee · Instant delivery · Every listing reviewed</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { to: string; label: string; search?: Record<string, unknown> }[];
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{title}</div>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.label + l.to}>
            <Link
              to={l.to}
              search={l.search as never}
              className="text-sm text-foreground/80 transition-colors hover:text-lume"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-[var(--content-width)] px-4 py-14 sm:py-20">
      {children}
    </section>
  );
}
