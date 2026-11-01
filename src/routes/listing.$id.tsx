import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Download,
  ExternalLink,
  Flag,
  History,
  Package,
  ShieldCheck,
  ShoppingCart,
  Star,
  MessageCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { ListingCard } from "@/components/listing-card";
import { Avatar, EmptyState, Stars } from "@/components/ui-kit";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ReviewSection } from "@/components/review-section";
import { formatMoney } from "@/lib/currencies";
import { fetchBrowse } from "@/lib/market";
import { REPORT_REASONS, addToCart, fetchCartIds, submitReport } from "@/lib/commerce";
import { toast } from "sonner";

const sb = supabase as any;

const listingQO = (id: string) =>
  queryOptions({
    queryKey: ["listing", id],
    queryFn: async () => {
      const { data, error } = await sb
        .from("listings")
        .select(
          "*, public_profiles:public_profiles!listings_seller_public_fkey(id,display_name,username,avatar_url,bio,website_url,created_at)",
        )
        .eq("id", id)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      return data as any;
    },
  });

export const Route = createFileRoute("/listing/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(listingQO(params.id)),
  head: ({ loaderData }) => {
    const l = loaderData as any;
    if (!l)
      return { meta: [{ title: "Unavailable — NORDEVA" }, { name: "robots", content: "noindex" }] };
    const title = `${l.title} — NORDEVA`;
    const desc = (l.description ?? "").slice(0, 155) || `Buy ${l.title} on NORDEVA.`;
    const meta: Array<Record<string, string>> = [
      { title },
      { name: "description", content: desc },
      { property: "og:title", content: title },
      { property: "og:description", content: desc },
      { property: "og:type", content: "product" },
      { name: "twitter:card", content: "summary_large_image" },
    ];
    if (l.cover_url && /^https:\/\//.test(l.cover_url)) {
      meta.push({ property: "og:image", content: l.cover_url });
      meta.push({ name: "twitter:image", content: l.cover_url });
    }
    return { meta };
  },
  errorComponent: ({ error }) => (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-3xl px-4 py-24 text-center" role="alert">
        <h1 className="text-2xl font-semibold">Couldn't load this product</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Something went wrong"}
        </p>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Product not found</h1>
        <Link to="/browse" search={{}} className="mt-4 inline-block text-sm text-lume">
          Back to marketplace →
        </Link>
      </div>
    </div>
  ),
  component: ListingDetail,
});

function ListingDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: l } = useSuspenseQuery(listingQO(id));
  const [versions, setVersions] = useState<any[]>([]);
  const [related, setRelated] = useState<any[]>([]);
  const [rating, setRating] = useState<{ avg: number; n: number } | null>(null);
  const [variants, setVariants] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [question, setQuestion] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [inCart, setInCart] = useState(false);
  const [adding, setAdding] = useState(false);
  const [reportReason, setReportReason] = useState<string>(REPORT_REASONS[0]);
  const [reportDetails, setReportDetails] = useState("");
  const [reporting, setReporting] = useState(false);
  const [details, setDetails] = useState<any | null>(null);

  useEffect(() => {
    sb.from("listing_product_details")
      .select("tags,features,included_items,requirements,tech_stack,platforms,languages,version")
      .eq("listing_id", id)
      .maybeSingle()
      .then(({ data }: any) => setDetails(data ?? null));
    sb.from("listing_versions")
      .select("*")
      .eq("listing_id", id)
      .order("created_at", { ascending: false })
      .then(({ data }: any) => setVersions(data ?? []));
    sb.from("product_variants")
      .select("id,name,price,currency,description,active")
      .eq("listing_id", id)
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }: any) => setVariants(data ?? []));
    sb.from("product_questions")
      .select("id,question,answer,created_at")
      .eq("listing_id", id)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }: any) => setQuestions(data ?? []));
    supabase.auth.getUser().then(({ data }: any) => setUserId(data.user?.id ?? null));
    sb.from("reviews")
      .select("rating")
      .eq("listing_id", id)
      .then(({ data }: any) => {
        if (data?.length) {
          setRating({
            avg: data.reduce((s: number, r: any) => s + r.rating, 0) / data.length,
            n: data.length,
          });
        } else setRating(null);
      });
    fetchBrowse({ kind: l.kind, perPage: 5 }).then((res) =>
      setRelated(res.items.filter((r) => r.id !== id).slice(0, 4)),
    );
  }, [id, l.kind]);

  useEffect(() => {
    if (!userId) return;
    fetchCartIds(userId).then((ids) => setInCart(ids.has(id)));
  }, [userId, id]);

  const handleAddToCart = async () => {
    if (!userId) {
      navigate({ to: "/auth", search: { next: `/listing/${id}` } });
      return;
    }
    setAdding(true);
    try {
      await addToCart(userId, id);
      setInCart(true);
      toast.success("Added to cart");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add to cart");
    } finally {
      setAdding(false);
    }
  };

  const seller = l.public_profiles;

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <Breadcrumb className="mb-8">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/">Home</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link
                  to="/browse"
                  search={{
                    q: undefined,
                    kind: undefined,
                    category: undefined,
                    sort: undefined,
                    page: undefined,
                  }}
                >
                  Marketplace
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {l.category && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link
                      to="/browse"
                      search={{
                        q: undefined,
                        kind: undefined,
                        category: l.category,
                        sort: undefined,
                        page: undefined,
                      }}
                    >
                      {l.category}
                    </Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="max-w-[36vw] truncate sm:max-w-xs">
                {l.title}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="grid gap-10 lg:grid-cols-[1.6fr_1fr]">
          <div className="min-w-0">
            <div className="overflow-hidden rounded-[1.5rem] border border-border/60 bg-muted">
              <div className="aspect-video">
                {l.cover_url ? (
                  <img src={l.cover_url} alt={l.title} className="size-full object-cover" />
                ) : (
                  <div className="size-full lume-gradient opacity-25" />
                )}
              </div>
            </div>

            <div className="mt-8">
              <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-lume">
                <span>{l.kind}</span>
                {l.category && <span className="text-muted-foreground">· {l.category}</span>}
              </div>
              <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{l.title}</h1>
              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                {rating ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Stars value={rating.avg} size={13} /> {rating.avg.toFixed(1)} ({rating.n})
                  </span>
                ) : (
                  <span>No reviews yet</span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Download className="size-3.5" /> {l.sales_count ?? 0} sold
                </span>
                <span>Listed {new Date(l.created_at).toLocaleDateString()}</span>
              </div>

              <p className="mt-7 whitespace-pre-wrap text-sm leading-7 text-foreground/90">
                {l.description}
              </p>

              {Array.isArray(details?.tags) && details.tags.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2" aria-label="Product tags">
                  {details.tags.slice(0, 12).map((tag: string) => (
                    <Link
                      key={tag}
                      to="/browse"
                      search={{
                        q: tag,
                        kind: undefined,
                        category: undefined,
                        sort: undefined,
                        page: undefined,
                      }}
                    >
                      <Badge
                        variant="secondary"
                        className="rounded-full px-3 py-1 text-xs font-medium transition-colors hover:bg-accent"
                      >
                        #{tag}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}

              {l.demo_url && (
                <a
                  href={l.demo_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-border/70 bg-card/60 px-4 py-2.5 text-sm transition-colors hover:border-lume/50"
                >
                  <ExternalLink className="size-4 text-lume" /> Open live demo
                </a>
              )}
            </div>

            {variants.length > 0 && (
              <section className="mt-12">
                <h2 className="text-xl font-semibold">Choose a version</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {variants.map((v) => (
                    <Link
                      key={v.id}
                      to="/checkout/$id"
                      params={{ id: l.id }}
                      search={{ variant: v.id }}
                      className="surface lift p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{v.name}</div>
                          {v.description && (
                            <p className="mt-1 text-xs text-muted-foreground">{v.description}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="lume-text font-semibold">
                            {formatMoney(Number(v.price), v.currency)}
                          </div>
                          <div className="mt-1 text-[10px] text-muted-foreground">Choose tier</div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-12">
              <h2 className="text-xl font-semibold">What's included</h2>
              <div className="surface mt-4 divide-y divide-border/60">
                <Row
                  label="Product type"
                  value={l.kind === "website" ? "Website / template" : "Software"}
                />
                {l.file_name && <Row label="Files" value={l.file_name} />}
                {l.file_size && (
                  <Row
                    label="Download size"
                    value={`${(l.file_size / (1024 * 1024)).toFixed(2)} MB`}
                  />
                )}
                <Row label="Delivery" value="Instant, signed download link after payment" />
                <Row label="Licence" value="Single-buyer licence issued by the creator" />
              </div>
            </section>

            <section className="mt-12">
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <History className="size-4 text-lume" /> Version history
              </h2>
              {versions.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    title="No versions published yet"
                    body="The creator hasn't added a changelog entry for this product."
                  />
                </div>
              ) : (
                <div className="surface mt-4 divide-y divide-border/60">
                  {versions.map((v) => (
                    <div key={v.id} className="p-5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">v{v.version}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(v.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      {v.notes && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                          {v.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-12">
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <MessageCircle className="size-4 text-lume" /> Product Q&A
              </h2>
              {userId && (
                <div className="surface mt-4 p-4">
                  <div className="flex gap-3">
                    <input
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Ask the creator a question…"
                      className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-lume/60"
                    />
                    <button
                      disabled={asking || !question.trim()}
                      onClick={async () => {
                        setAsking(true);
                        const { error } = await sb
                          .from("product_questions")
                          .insert({ listing_id: id, user_id: userId, question: question.trim() });
                        setAsking(false);
                        if (error) toast.error(error.message);
                        else {
                          setQuestion("");
                          const { data } = await sb
                            .from("product_questions")
                            .select("id,question,answer,created_at")
                            .eq("listing_id", id)
                            .order("created_at", { ascending: false })
                            .limit(20);
                          setQuestions(data ?? []);
                          toast.success("Question posted");
                        }
                      }}
                      className="rounded-xl lume-gradient px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {asking ? "Posting…" : "Ask"}
                    </button>
                  </div>
                </div>
              )}
              <div className="surface mt-4 divide-y divide-border/60">
                {questions.length === 0 ? (
                  <div className="p-5 text-sm text-muted-foreground">No questions yet.</div>
                ) : (
                  questions.map((q) => (
                    <div key={q.id} className="p-5">
                      <div className="text-sm font-medium">{q.question}</div>
                      {q.answer ? (
                        <div className="mt-2 text-sm text-muted-foreground">
                          <span className="text-foreground">Creator:</span> {q.answer}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Waiting for a creator response.
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>

            <ReviewSection listingId={id} />
          </div>

          <aside className="lg:sticky lg:top-24 lg:h-fit">
            <div className="glass-panel rounded-[1.5rem] p-6">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-xs text-muted-foreground">Price</div>
                {details?.version && (
                  <div className="text-[11px] text-muted-foreground">
                    Current version {details.version}
                  </div>
                )}
              </div>
              <div className="mt-1 text-4xl font-semibold lume-text">
                {formatMoney(Number(l.price), l.currency)}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Single-buyer licence, issued by the creator after purchase.
              </p>
              <Link
                to="/checkout/$id"
                params={{ id: l.id }}
                search={{ variant: undefined }}
                className="glow-btn mt-5 flex w-full items-center justify-center gap-2 rounded-2xl lume-gradient px-6 py-3.5 text-sm font-semibold text-white"
              >
                Buy now
              </Link>
              {inCart ? (
                <Link
                  to="/cart"
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-lume/50 bg-lume/10 px-6 py-3 text-sm font-medium text-lume transition-colors hover:bg-lume/15"
                >
                  <ShoppingCart className="size-4" /> In your cart — view cart
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={adding}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card/60 px-6 py-3 text-sm font-medium transition-colors hover:border-lume/50 disabled:opacity-50"
                >
                  <ShoppingCart className="size-4" /> {adding ? "Adding…" : "Add to cart"}
                </button>
              )}
              {l.demo_url && (
                <a
                  href={l.demo_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card/60 px-6 py-3 text-sm font-medium transition-colors hover:border-lume/50"
                >
                  <ExternalLink className="size-4 text-lume" /> Live preview
                </a>
              )}
              {variants.length > 0 && (
                <p className="mt-3 text-center text-[11px] text-muted-foreground">
                  Select a tier above to buy a variant.
                </p>
              )}
              <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3.5" /> Secure checkout · instant download
              </p>
              <div className="mt-5 border-t border-border/60 pt-4">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Support
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  Questions about this product? Ask in the Q&amp;A below — the creator answers
                  there. Your files are delivered instantly after payment through a signed download
                  link.
                </p>
              </div>
            </div>

            <div className="mt-5">
              <button
                onClick={() => setReportOpen((v) => !v)}
                aria-expanded={reportOpen}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <Flag className="size-3.5" /> Report this product
              </button>
              {reportOpen &&
                (userId ? (
                  <div className="surface mt-3 p-4">
                    <label className="text-xs font-medium" htmlFor="report-reason">
                      What's wrong with this product?
                    </label>
                    <select
                      id="report-reason"
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      className="mt-2 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-lume/60"
                    >
                      {REPORT_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={reportDetails}
                      onChange={(e) => setReportDetails(e.target.value)}
                      placeholder="Anything else the review team should know? (optional)"
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-lume/60"
                    />
                    <button
                      disabled={reporting}
                      onClick={async () => {
                        setReporting(true);
                        try {
                          await submitReport({
                            userId,
                            listingId: id,
                            reason: reportReason,
                            details: reportDetails,
                          });
                          setReportOpen(false);
                          setReportDetails("");
                          toast.success("Report sent — the admin team will review it.");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Could not send report");
                        } finally {
                          setReporting(false);
                        }
                      }}
                      className="mt-3 w-full rounded-xl border border-border/70 px-4 py-2.5 text-sm font-medium transition-colors hover:border-lume/50 disabled:opacity-50"
                    >
                      {reporting ? "Sending…" : "Send report"}
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    <Link to="/auth" className="text-lume underline">
                      Sign in
                    </Link>{" "}
                    to report this product.
                  </p>
                ))}
            </div>

            {seller && (
              <div className="surface mt-5 p-6">
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  Creator
                </div>
                <Link
                  to="/creator/$username"
                  params={{ username: seller.username ?? seller.id }}
                  className="mt-4 flex items-center gap-3"
                >
                  <Avatar
                    name={seller.display_name ?? seller.username}
                    url={seller.avatar_url}
                    size={44}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {seller.display_name ?? seller.username ?? "Creator"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Joined {new Date(seller.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </Link>
                {seller.bio && (
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{seller.bio}</p>
                )}
              </div>
            )}
          </aside>
        </div>

        <section className="mt-16">
          <h2 className="text-xl font-semibold sm:text-2xl">Related products</h2>
          {related.length === 0 ? (
            <div className="mt-5">
              <EmptyState icon={<Package className="size-5" />} title="Nothing related yet" />
            </div>
          ) : (
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((r) => (
                <ListingCard key={r.id} l={r} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{value}</span>
    </div>
  );
}
