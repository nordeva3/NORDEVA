-- VELORA Product Studio + Admin 2.0
-- Additive schema. Existing listings and commerce data are preserved.

CREATE TABLE IF NOT EXISTS public.listing_product_details (
  listing_id UUID PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL DEFAULT 'software',
  short_description TEXT,
  subcategory TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  included_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_audience TEXT,
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  languages JSONB NOT NULL DEFAULT '[]'::jsonb,
  requirements TEXT,
  tech_stack JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_formats JSONB NOT NULL DEFAULT '[]'::jsonb,
  version TEXT,
  release_date DATE,
  last_updated DATE,
  pricing_model TEXT NOT NULL DEFAULT 'one_time',
  trial_days INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  pay_what_you_want BOOLEAN NOT NULL DEFAULT false,
  minimum_price NUMERIC(12,2) CHECK (minimum_price IS NULL OR minimum_price >= 0),
  license_type TEXT NOT NULL DEFAULT 'standard',
  license_seats INTEGER NOT NULL DEFAULT 1 CHECK (license_seats > 0),
  activation_limit INTEGER CHECK (activation_limit IS NULL OR activation_limit > 0),
  license_duration_days INTEGER CHECK (license_duration_days IS NULL OR license_duration_days > 0),
  tax_category TEXT,
  support_url TEXT,
  documentation_url TEXT,
  seo_title TEXT,
  seo_description TEXT,
  seo_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  changelog TEXT,
  ai_used BOOLEAN NOT NULL DEFAULT false,
  ai_details TEXT,
  rights_confirmed BOOLEAN NOT NULL DEFAULT false,
  assets_confirmed BOOLEAN NOT NULL DEFAULT false,
  legal_confirmed BOOLEAN NOT NULL DEFAULT false,
  quality_score INTEGER NOT NULL DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.listing_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('cover','screenshot','gallery','video','gif')),
  storage_path TEXT,
  external_url TEXT,
  title TEXT,
  alt_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_media_listing_idx ON public.listing_media(listing_id, sort_order);

CREATE TABLE IF NOT EXISTS public.listing_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  asset_kind TEXT NOT NULL DEFAULT 'download',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  checksum_sha256 TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_assets_listing_idx ON public.listing_assets(listing_id, sort_order);

CREATE TABLE IF NOT EXISTS public.listing_faq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.listing_product_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_faq ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.listing_product_details, public.listing_media, public.listing_faq TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_product_details, public.listing_media, public.listing_assets, public.listing_faq TO authenticated;
GRANT ALL ON public.listing_product_details, public.listing_media, public.listing_assets, public.listing_faq TO service_role;

DROP POLICY IF EXISTS "product details public read" ON public.listing_product_details;
CREATE POLICY "product details public read" ON public.listing_product_details FOR SELECT USING (true);
DROP POLICY IF EXISTS "product details seller manage" ON public.listing_product_details;
CREATE POLICY "product details seller manage" ON public.listing_product_details FOR ALL TO authenticated
  USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "listing media public read" ON public.listing_media;
CREATE POLICY "listing media public read" ON public.listing_media FOR SELECT USING (true);
DROP POLICY IF EXISTS "listing media seller manage" ON public.listing_media;
CREATE POLICY "listing media seller manage" ON public.listing_media FOR ALL TO authenticated
  USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "listing assets seller manage" ON public.listing_assets;
CREATE POLICY "listing assets seller manage" ON public.listing_assets FOR ALL TO authenticated
  USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "listing faq public read" ON public.listing_faq;
CREATE POLICY "listing faq public read" ON public.listing_faq FOR SELECT USING (true);
DROP POLICY IF EXISTS "listing faq seller manage" ON public.listing_faq;
CREATE POLICY "listing faq seller manage" ON public.listing_faq FOR ALL TO authenticated
  USING (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id) OR public.has_role(auth.uid(),'admin'));

DROP TRIGGER IF EXISTS listing_product_details_touch ON public.listing_product_details;
CREATE TRIGGER listing_product_details_touch BEFORE UPDATE ON public.listing_product_details
FOR EACH ROW EXECUTE FUNCTION public.touch_global_updated_at();

-- Admin can see operational tables through existing service-side queries. Add a lightweight queue table for explicit moderation actions.
CREATE TABLE IF NOT EXISTS public.admin_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL CHECK (task_type IN ('moderation','verification','support','refund','payout','report','security')),
  target_id UUID,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','dismissed')),
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_tasks_queue_idx ON public.admin_tasks(status, priority, created_at DESC);
ALTER TABLE public.admin_tasks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_tasks TO authenticated;
GRANT ALL ON public.admin_tasks TO service_role;
DROP POLICY IF EXISTS "admin tasks admin only" ON public.admin_tasks;
CREATE POLICY "admin tasks admin only" ON public.admin_tasks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP TRIGGER IF EXISTS admin_tasks_touch ON public.admin_tasks;
CREATE TRIGGER admin_tasks_touch BEFORE UPDATE ON public.admin_tasks
FOR EACH ROW EXECUTE FUNCTION public.touch_global_updated_at();

CREATE TABLE IF NOT EXISTS public.admin_user_controls (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','restricted','suspended','banned')),
  note TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_user_controls ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.admin_user_controls TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.admin_user_controls TO authenticated;
GRANT ALL ON public.admin_user_controls TO service_role;
DROP POLICY IF EXISTS "admin user controls admin only" ON public.admin_user_controls;
CREATE POLICY "admin user controls admin only" ON public.admin_user_controls FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP TRIGGER IF EXISTS admin_user_controls_touch ON public.admin_user_controls;
CREATE TRIGGER admin_user_controls_touch BEFORE UPDATE ON public.admin_user_controls
FOR EACH ROW EXECUTE FUNCTION public.touch_global_updated_at();

CREATE TABLE IF NOT EXISTS public.seller_verification_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id UUID NOT NULL REFERENCES public.seller_verifications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.seller_verification_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_verification_documents TO authenticated;
GRANT ALL ON public.seller_verification_documents TO service_role;
DROP POLICY IF EXISTS "verification docs owner admin" ON public.seller_verification_documents;
CREATE POLICY "verification docs owner admin" ON public.seller_verification_documents FOR ALL TO authenticated
  USING (verification_id IN (SELECT id FROM public.seller_verifications WHERE user_id = auth.uid()) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (verification_id IN (SELECT id FROM public.seller_verifications WHERE user_id = auth.uid()) OR public.has_role(auth.uid(),'admin'));
