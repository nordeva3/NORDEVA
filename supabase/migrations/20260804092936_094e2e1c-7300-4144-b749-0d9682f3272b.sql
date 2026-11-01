-- profile enrichment
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS twitter_url TEXT,
  ADD COLUMN IF NOT EXISTS github_url TEXT;

-- REVIEWS
CREATE TABLE IF NOT EXISTS public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, user_id)
);
GRANT SELECT ON public.reviews TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reviews public read" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "verified buyers insert review" ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.listing_id = reviews.listing_id
        AND o.buyer_id = auth.uid()
        AND o.status = 'completed'
    )
  );
CREATE POLICY "authors update own review" ON public.reviews FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "authors delete own review" ON public.reviews FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- HELPFUL MARKS
CREATE TABLE IF NOT EXISTS public.review_helpful (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (review_id, user_id)
);
GRANT SELECT ON public.review_helpful TO anon;
GRANT SELECT, INSERT, DELETE ON public.review_helpful TO authenticated;
GRANT ALL ON public.review_helpful TO service_role;
ALTER TABLE public.review_helpful ENABLE ROW LEVEL SECURITY;
CREATE POLICY "helpful public read" ON public.review_helpful FOR SELECT USING (true);
CREATE POLICY "helpful insert own" ON public.review_helpful FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "helpful delete own" ON public.review_helpful FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- FOLLOWS
CREATE TABLE IF NOT EXISTS public.follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (follower_id, creator_id),
  CHECK (follower_id <> creator_id)
);
GRANT SELECT ON public.follows TO anon;
GRANT SELECT, INSERT, DELETE ON public.follows TO authenticated;
GRANT ALL ON public.follows TO service_role;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "follows public read" ON public.follows FOR SELECT USING (true);
CREATE POLICY "follows insert own" ON public.follows FOR INSERT TO authenticated WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "follows delete own" ON public.follows FOR DELETE TO authenticated USING (auth.uid() = follower_id);

-- VERSION HISTORY
CREATE TABLE IF NOT EXISTS public.listing_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.listing_versions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_versions TO authenticated;
GRANT ALL ON public.listing_versions TO service_role;
ALTER TABLE public.listing_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "versions public read" ON public.listing_versions FOR SELECT USING (true);
CREATE POLICY "seller manages versions" ON public.listing_versions FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_versions.listing_id AND l.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_versions.listing_id AND l.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

-- AGGREGATE STATS (no private rows exposed)
CREATE OR REPLACE VIEW public.listing_stats AS
SELECT
  l.id AS listing_id,
  (SELECT count(*) FROM public.orders o WHERE o.listing_id = l.id AND o.status = 'completed') AS sales_count,
  (SELECT count(*) FROM public.reviews r WHERE r.listing_id = l.id) AS rating_count,
  (SELECT round(avg(r.rating)::numeric, 2) FROM public.reviews r WHERE r.listing_id = l.id) AS rating_avg
FROM public.listings l;
GRANT SELECT ON public.listing_stats TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.creator_stats AS
SELECT
  p.id AS creator_id,
  (SELECT count(*) FROM public.listings l WHERE l.seller_id = p.id AND l.status = 'active') AS products,
  (SELECT count(*) FROM public.follows f WHERE f.creator_id = p.id) AS followers,
  (SELECT count(*) FROM public.orders o WHERE o.seller_id = p.id AND o.status = 'completed') AS sales,
  (SELECT round(avg(r.rating)::numeric, 2) FROM public.reviews r
     JOIN public.listings l2 ON l2.id = r.listing_id WHERE l2.seller_id = p.id) AS rating_avg
FROM public.profiles p;
GRANT SELECT ON public.creator_stats TO anon, authenticated, service_role;