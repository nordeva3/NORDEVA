import { useEffect, useState } from "react";
import { BadgeCheck, MessageSquare, Star, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, EmptyState, Stars } from "./ui-kit";

const sb = supabase as any;

type Review = {
  id: string;
  rating: number;
  body: string | null;
  created_at: string;
  user_id: string;
  public_profiles: {
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  } | null;
};

export function ReviewSection({ listingId }: { listingId: string }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [helpful, setHelpful] = useState<Record<string, number>>({});
  const [myHelpful, setMyHelpful] = useState<Set<string>>(new Set());
  const [userId, setUserId] = useState<string | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await sb
      .from("reviews")
      .select(
        "id,rating,body,created_at,user_id,public_profiles:public_profiles!reviews_user_public_fkey(display_name,username,avatar_url)",
      )
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false });
    const rows: Review[] = data ?? [];
    setReviews(rows);

    if (rows.length) {
      const { data: marks } = await sb
        .from("review_helpful")
        .select("review_id,user_id")
        .in(
          "review_id",
          rows.map((r) => r.id),
        );
      const counts: Record<string, number> = {};
      const mine = new Set<string>();
      const { data: auth } = await supabase.auth.getUser();
      for (const m of marks ?? []) {
        counts[m.review_id] = (counts[m.review_id] ?? 0) + 1;
        if (auth.user && m.user_id === auth.user.id) mine.add(m.review_id);
      }
      setHelpful(counts);
      setMyHelpful(mine);
    }
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      setUserId(uid);
      await load();
      if (uid) {
        const { data: order } = await sb
          .from("orders")
          .select("id")
          .eq("listing_id", listingId)
          .eq("buyer_id", uid)
          .eq("status", "completed")
          .limit(1)
          .maybeSingle();
        setCanReview(!!order);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  const mine = reviews.find((r) => r.user_id === userId);
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setSaving(true);
    const payload = { listing_id: listingId, user_id: userId, rating, body: body.trim() || null };
    const { error } = mine
      ? await sb.from("reviews").update({ rating, body: payload.body }).eq("id", mine.id)
      : await sb.from("reviews").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(mine ? "Review updated" : "Review posted");
    setBody("");
    load();
  };

  const toggleHelpful = async (reviewId: string) => {
    if (!userId) return toast.error("Sign in to mark reviews helpful");
    if (myHelpful.has(reviewId)) {
      await sb.from("review_helpful").delete().eq("review_id", reviewId).eq("user_id", userId);
    } else {
      await sb.from("review_helpful").insert({ review_id: reviewId, user_id: userId });
    }
    load();
  };

  return (
    <section className="mt-14">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <h2 className="text-xl font-semibold sm:text-2xl">Reviews</h2>
        {avg != null && (
          <div className="flex shrink-0 items-center gap-2 text-sm">
            <Stars value={avg} size={14} />
            <span className="font-medium">{avg.toFixed(1)}</span>
            <span className="text-muted-foreground">({reviews.length})</span>
          </div>
        )}
      </div>

      {canReview && (
        <form onSubmit={submit} className="surface mt-6 p-5">
          <div className="text-sm font-medium">
            {mine ? "Update your review" : "Write a review"}
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setRating(i)}
                aria-label={`${i} star${i > 1 ? "s" : ""}`}
                className="transition-transform hover:scale-110"
              >
                <Star
                  className={`size-5 ${i <= rating ? "fill-gold text-gold" : "text-muted-foreground/40"}`}
                />
              </button>
            ))}
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What worked well? What could be better?"
            className="mt-4 w-full rounded-2xl border border-border/60 bg-muted/50 p-4 text-sm focus:border-lume/60 focus:outline-none"
          />
          <button
            disabled={saving}
            className="glow-btn mt-4 inline-flex items-center gap-2 rounded-2xl lume-gradient px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : mine ? "Update review" : "Post review"}
          </button>
        </form>
      )}

      {!canReview && userId && !mine && (
        <p className="mt-5 text-xs text-muted-foreground">
          Only verified buyers of this product can leave a review.
        </p>
      )}

      <div className="mt-6 space-y-4">
        {loading ? (
          <div className="skeleton h-24 w-full" />
        ) : reviews.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="size-5" />}
            title="No reviews yet"
            body="NORDEVA only shows reviews written by verified buyers, so this stays empty until someone who purchased leaves one."
          />
        ) : (
          reviews.map((r) => (
            <div key={r.id} className="surface p-5">
              <div className="flex items-start gap-3">
                <Avatar
                  name={r.public_profiles?.display_name ?? r.public_profiles?.username}
                  url={r.public_profiles?.avatar_url}
                  size={36}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {r.public_profiles?.display_name ?? r.public_profiles?.username ?? "Buyer"}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-lume/30 bg-lume/10 px-2 py-0.5 text-[10px] text-lume">
                      <BadgeCheck className="size-3" /> Purchase verified
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Stars value={r.rating} />
                  </div>
                  {r.body && (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{r.body}</p>
                  )}
                  <button
                    onClick={() => toggleHelpful(r.id)}
                    className={`mt-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
                      myHelpful.has(r.id)
                        ? "border-lume/40 bg-lume/10 text-lume"
                        : "border-border/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <ThumbsUp className="size-3" /> Helpful{" "}
                    {helpful[r.id] ? `· ${helpful[r.id]}` : ""}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
