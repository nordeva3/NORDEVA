-- listings: new product fields
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS version text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS docs_url text,
  ADD COLUMN IF NOT EXISTS screenshots text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS views_count integer NOT NULL DEFAULT 0;

-- allow drafts: sellers may only set draft or pending
CREATE OR REPLACE FUNCTION public.enforce_listing_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
      IF NEW.status IS DISTINCT FROM 'draft' THEN
        NEW.status := 'pending';
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND auth.uid() IS NOT NULL
       AND NOT public.has_role(auth.uid(), 'admin') THEN
      IF NOT (OLD.status = 'draft' AND NEW.status IN ('draft', 'pending')) THEN
        RAISE EXCEPTION 'Only admins can change listing status';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- sellers see their own hidden (draft/pending/rejected) listings
DROP POLICY IF EXISTS "seller reads own listings" ON public.listings;
CREATE POLICY "seller reads own listings" ON public.listings
  FOR SELECT TO authenticated USING (auth.uid() = seller_id);

-- sellers may delete their own listings that have never sold
DROP POLICY IF EXISTS "seller deletes unsold listing" ON public.listings;
CREATE POLICY "seller deletes unsold listing" ON public.listings
  FOR DELETE TO authenticated USING (auth.uid() = seller_id AND sales_count = 0);

-- encrypted private delivery vault (server-only)
CREATE TABLE IF NOT EXISTS public.listing_private_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL UNIQUE REFERENCES public.listings(id) ON DELETE CASCADE,
  content_ciphertext text,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.listing_private_delivery TO service_role;
ALTER TABLE public.listing_private_delivery ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS lpd_updated_at ON public.listing_private_delivery;
CREATE TRIGGER lpd_updated_at BEFORE UPDATE ON public.listing_private_delivery
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- wishlists
CREATE TABLE IF NOT EXISTS public.wishlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, listing_id)
);
GRANT SELECT, INSERT, DELETE ON public.wishlists TO authenticated;
GRANT ALL ON public.wishlists TO service_role;
ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own wishlist" ON public.wishlists FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own wishlist insert" ON public.wishlists FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own wishlist delete" ON public.wishlists FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- cart
CREATE TABLE IF NOT EXISTS public.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, listing_id)
);
GRANT SELECT, INSERT, DELETE ON public.cart_items TO authenticated;
GRANT ALL ON public.cart_items TO service_role;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cart" ON public.cart_items FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own cart insert" ON public.cart_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own cart delete" ON public.cart_items FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- reports
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or admin reports read" ON public.reports FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "insert own report" ON public.reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- reviews: images, seller reply, edit stamp
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS seller_reply text,
  ADD COLUMN IF NOT EXISTS seller_replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

DROP POLICY IF EXISTS "seller replies to review" ON public.reviews;
CREATE POLICY "seller replies to review" ON public.reviews FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.listings l WHERE l.id = reviews.listing_id AND l.seller_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.listings l WHERE l.id = reviews.listing_id AND l.seller_id = auth.uid()));

-- real view tracking
CREATE TABLE IF NOT EXISTS public.listing_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  viewer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.listing_views TO anon, authenticated;
GRANT SELECT ON public.listing_views TO authenticated;
GRANT ALL ON public.listing_views TO service_role;
ALTER TABLE public.listing_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone records a view" ON public.listing_views FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "seller reads own views" ON public.listing_views FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_views.listing_id AND l.seller_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.bump_listing_views()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.listings SET views_count = views_count + 1 WHERE id = NEW.listing_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bump_listing_views() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_bump_listing_views ON public.listing_views;
CREATE TRIGGER trg_bump_listing_views AFTER INSERT ON public.listing_views
  FOR EACH ROW EXECUTE FUNCTION public.bump_listing_views();

CREATE INDEX IF NOT EXISTS idx_listing_views_listing ON public.listing_views(listing_id);
CREATE INDEX IF NOT EXISTS idx_listings_status_created ON public.listings(status, created_at DESC);