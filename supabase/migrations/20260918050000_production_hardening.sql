-- VELORA Production Hardening (payment provider intentionally unchanged)
-- Safe, additive migration: does not delete marketplace data.

/* -------------------------------------------------------------------------- */
/* Public/private profile split                                               */
/* -------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.public_profiles (
  id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name TEXT,
  username TEXT,
  avatar_url TEXT,
  bio TEXT,
  website_url TEXT,
  twitter_url TEXT,
  github_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.public_profiles (id, display_name, username, avatar_url, bio, website_url, twitter_url, github_url, created_at)
SELECT id, display_name, username, avatar_url, bio, website_url, twitter_url, github_url, created_at
FROM public.profiles
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  username = EXCLUDED.username,
  avatar_url = EXCLUDED.avatar_url,
  bio = EXCLUDED.bio,
  website_url = EXCLUDED.website_url,
  twitter_url = EXCLUDED.twitter_url,
  github_url = EXCLUDED.github_url;

GRANT SELECT ON public.public_profiles TO anon, authenticated;
GRANT ALL ON public.public_profiles TO service_role;
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public profiles readable" ON public.public_profiles;
CREATE POLICY "public profiles readable" ON public.public_profiles FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.sync_public_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.public_profiles WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.public_profiles (
    id, display_name, username, avatar_url, bio, website_url, twitter_url, github_url, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.display_name, NEW.username, NEW.avatar_url, NEW.bio, NEW.website_url, NEW.twitter_url, NEW.github_url,
    NEW.created_at, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    username = EXCLUDED.username,
    avatar_url = EXCLUDED.avatar_url,
    bio = EXCLUDED.bio,
    website_url = EXCLUDED.website_url,
    twitter_url = EXCLUDED.twitter_url,
    github_url = EXCLUDED.github_url,
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_public_profile ON public.profiles;
CREATE TRIGGER trg_sync_public_profile
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_public_profile();
REVOKE ALL ON FUNCTION public.sync_public_profile() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "profiles readable by all" ON public.profiles;
DROP POLICY IF EXISTS "profiles own read" ON public.profiles;
CREATE POLICY "profiles own read" ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

/* listings/reviews can use public_profiles for PostgREST embeddings */
ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_seller_public_fkey;
ALTER TABLE public.listings
  ADD CONSTRAINT listings_seller_public_fkey
  FOREIGN KEY (seller_id) REFERENCES public.public_profiles(id) ON DELETE NO ACTION;

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_user_public_fkey;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_user_public_fkey
  FOREIGN KEY (user_id) REFERENCES public.public_profiles(id) ON DELETE NO ACTION;

/* -------------------------------------------------------------------------- */
/* Request board privacy + stronger lifecycle rules                           */
/* -------------------------------------------------------------------------- */
DROP POLICY IF EXISTS "Anyone can view requests" ON public.website_requests;
DROP POLICY IF EXISTS "Requester can update own request" ON public.website_requests;
DROP POLICY IF EXISTS "Taker can claim or update taken request" ON public.website_requests;

CREATE POLICY "requester reads own request" ON public.website_requests FOR SELECT TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = taken_by OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "requester updates open request" ON public.website_requests FOR UPDATE TO authenticated
USING (auth.uid() = requester_id AND status IN ('open','cancelled'))
WITH CHECK (auth.uid() = requester_id AND status IN ('open','cancelled'));

CREATE POLICY "taker updates taken request" ON public.website_requests FOR UPDATE TO authenticated
USING (auth.uid() = taken_by AND status = 'taken')
WITH CHECK (auth.uid() = taken_by AND status IN ('taken','completed'));

CREATE POLICY "admin manages requests" ON public.website_requests FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.claim_website_request(request_id UUID, claimer_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed INTEGER;
BEGIN
  IF claimer_id IS NULL OR auth.uid() IS DISTINCT FROM claimer_id THEN
    RAISE EXCEPTION 'Unauthorized request claim';
  END IF;

  UPDATE public.website_requests
  SET status = 'taken', taken_by = claimer_id, taken_at = now(), updated_at = now()
  WHERE id = request_id
    AND status = 'open'
    AND taken_by IS NULL
    AND requester_id <> claimer_id;

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_website_request(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_website_request(request_id UUID, actor_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed INTEGER;
BEGIN
  IF actor_id IS NULL OR auth.uid() IS DISTINCT FROM actor_id THEN
    RAISE EXCEPTION 'Unauthorized request completion';
  END IF;

  UPDATE public.website_requests
  SET status = 'completed', updated_at = now()
  WHERE id = request_id
    AND status = 'taken'
    AND (requester_id = actor_id OR taken_by = actor_id);

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_website_request(UUID, UUID) TO authenticated;

/* -------------------------------------------------------------------------- */
/* Payout integrity                                                            */
/* -------------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION public.enforce_payout_method_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.method_id IS NULL THEN
    RAISE EXCEPTION 'A payout method is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.payout_methods pm
    WHERE pm.id = NEW.method_id AND pm.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Payout method does not belong to this seller';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payout_requests_enforce_method_owner ON public.payout_requests;
CREATE TRIGGER payout_requests_enforce_method_owner
BEFORE INSERT OR UPDATE OF method_id, user_id ON public.payout_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_payout_method_owner();
REVOKE ALL ON FUNCTION public.enforce_payout_method_owner() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.payout_requests
  ADD COLUMN IF NOT EXISTS admin_note TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.finalize_payout_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('paid','rejected') AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.processed_at := COALESCE(NEW.processed_at, now());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payout_requests_finalize ON public.payout_requests;
CREATE TRIGGER payout_requests_finalize
BEFORE UPDATE ON public.payout_requests
FOR EACH ROW EXECUTE FUNCTION public.finalize_payout_request();
REVOKE ALL ON FUNCTION public.finalize_payout_request() FROM PUBLIC, anon, authenticated;

/* -------------------------------------------------------------------------- */
/* Reviews: seller replies and authors cannot move ownership                   */
/* -------------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION public.protect_review_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.listing_id IS DISTINCT FROM OLD.listing_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Review ownership cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reviews_protect_identity ON public.reviews;
CREATE TRIGGER reviews_protect_identity
BEFORE UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.protect_review_identity();
REVOKE ALL ON FUNCTION public.protect_review_identity() FROM PUBLIC, anon, authenticated;

/* -------------------------------------------------------------------------- */
/* Refund/dispute workflow (payment provider is intentionally not called)     */
/* -------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','approved','rejected','resolved')),
  admin_note TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS refund_requests_status_idx ON public.refund_requests(status, created_at DESC);
GRANT SELECT, INSERT ON public.refund_requests TO authenticated;
GRANT ALL ON public.refund_requests TO service_role;
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "buyers read own refunds" ON public.refund_requests;
CREATE POLICY "buyers read own refunds" ON public.refund_requests FOR SELECT TO authenticated
USING (auth.uid() = buyer_id OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "buyers create own refunds" ON public.refund_requests;
CREATE POLICY "buyers create own refunds" ON public.refund_requests FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = buyer_id
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND o.buyer_id = auth.uid() AND o.status = 'completed'
  )
);
DROP POLICY IF EXISTS "admin updates refunds" ON public.refund_requests;
CREATE POLICY "admin updates refunds" ON public.refund_requests FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS refund_requests_updated_at ON public.refund_requests;
CREATE TRIGGER refund_requests_updated_at
BEFORE UPDATE ON public.refund_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

/* -------------------------------------------------------------------------- */
/* Admin audit log                                                             */
/* -------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON public.admin_audit_log(target_type, target_id);
GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit log" ON public.admin_audit_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.write_admin_audit(
  p_admin_id UUID,
  p_action TEXT,
  p_target_type TEXT,
  p_target_id UUID,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  INSERT INTO public.admin_audit_log(admin_id, action, target_type, target_id, metadata)
  VALUES (p_admin_id, p_action, p_target_type, p_target_id, COALESCE(p_metadata, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.write_admin_audit(UUID,TEXT,TEXT,UUID,JSONB) FROM PUBLIC, anon, authenticated;

/* -------------------------------------------------------------------------- */
/* Newsletter backend                                                         */
/* -------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','unsubscribed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_idx ON public.newsletter_subscribers (LOWER(email));
GRANT INSERT, SELECT ON public.newsletter_subscribers TO anon, authenticated;
GRANT ALL ON public.newsletter_subscribers TO service_role;
ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "newsletter insert" ON public.newsletter_subscribers;
CREATE POLICY "newsletter insert" ON public.newsletter_subscribers FOR INSERT TO anon, authenticated
WITH CHECK (length(trim(email)) BETWEEN 5 AND 320);
DROP POLICY IF EXISTS "newsletter own read" ON public.newsletter_subscribers;
CREATE POLICY "newsletter own read" ON public.newsletter_subscribers FOR SELECT TO authenticated
USING (false);
DROP TRIGGER IF EXISTS newsletter_updated_at ON public.newsletter_subscribers;
CREATE TRIGGER newsletter_updated_at BEFORE UPDATE ON public.newsletter_subscribers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

/* -------------------------------------------------------------------------- */
/* Product/file validation                                                     */
/* -------------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION public.validate_listing_assets()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE ext TEXT;
BEGIN
  IF NEW.file_size IS NOT NULL AND NEW.file_size > 209715200 THEN
    RAISE EXCEPTION 'Product file exceeds the 200 MB limit';
  END IF;
  IF NEW.file_path IS NOT NULL THEN
    ext := lower(split_part(NEW.file_path, '.', array_length(string_to_array(NEW.file_path, '.'), 1)));
    IF ext NOT IN ('zip','rar','7z','tar','gz','tgz','dmg','exe','msi','apk','ipa') THEN
      RAISE EXCEPTION 'Unsupported product archive/file type';
    END IF;
  END IF;
  IF NEW.docs_url IS NOT NULL AND NEW.docs_url <> '' AND NOT NEW.docs_url ~* '^https?://[^\s]+$' THEN
    RAISE EXCEPTION 'docs_url must be a valid http(s) URL';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS listings_validate_assets ON public.listings;
CREATE TRIGGER listings_validate_assets
BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.validate_listing_assets();
REVOKE ALL ON FUNCTION public.validate_listing_assets() FROM PUBLIC, anon, authenticated;

/* -------------------------------------------------------------------------- */
/* Initial admin bootstrap for the requested owner account                    */
/* -------------------------------------------------------------------------- */
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(email) = lower('nebulasoftwareplat@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;

/* Public request board intentionally excludes contact details. */
DROP VIEW IF EXISTS public.website_requests_public;
CREATE VIEW public.website_requests_public AS
SELECT id, requester_id, title, description, budget, currency, status, taken_by, taken_at,
       created_at, updated_at, tier, photos
FROM public.website_requests;
GRANT SELECT ON public.website_requests_public TO anon, authenticated;

DROP POLICY IF EXISTS "Authenticated can read request photos" ON storage.objects;
CREATE POLICY "Request participants read request photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'request-photos'
  AND EXISTS (
    SELECT 1
    FROM public.website_requests wr
    WHERE wr.photos @> ARRAY[name]::text[]
      AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

/* Ensure the owner account receives admin on future sign-up too. */
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_username TEXT;
  meta_display TEXT;
BEGIN
  meta_username := NULLIF(NEW.raw_user_meta_data->>'username', '');
  meta_display := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    meta_username,
    split_part(NEW.email, '@', 1)
  );
  IF meta_username IS NOT NULL AND meta_username !~ '^[A-Za-z0-9_]{3,20}$' THEN
    meta_username := NULL;
  END IF;

  INSERT INTO public.profiles (id, email, display_name, username)
  VALUES (NEW.id, NEW.email, meta_display, meta_username)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  IF lower(COALESCE(NEW.email, '')) = lower('nebulasoftwareplat@gmail.com') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, meta_display)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

/* Prevent forged product-file ownership and spoofed analytics identities. */
CREATE OR REPLACE FUNCTION public.validate_listing_assets()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE ext TEXT;
DECLARE owner_folder TEXT;
BEGIN
  IF NEW.file_size IS NOT NULL AND NEW.file_size > 209715200 THEN
    RAISE EXCEPTION 'Product file exceeds the 200 MB limit';
  END IF;
  IF NEW.file_path IS NOT NULL THEN
    owner_folder := split_part(NEW.file_path, '/', 1);
    IF owner_folder IS DISTINCT FROM NEW.seller_id::text THEN
      RAISE EXCEPTION 'Product file must belong to the seller upload folder';
    END IF;
    ext := lower(split_part(NEW.file_path, '.', array_length(string_to_array(NEW.file_path, '.'), 1)));
    IF ext NOT IN ('zip','rar','7z','tar','gz','tgz','dmg','exe','msi','apk','ipa') THEN
      RAISE EXCEPTION 'Unsupported product archive/file type';
    END IF;
  END IF;
  IF NEW.docs_url IS NOT NULL AND NEW.docs_url <> '' AND NOT NEW.docs_url ~* '^https?://[^\s]+$' THEN
    RAISE EXCEPTION 'docs_url must be a valid http(s) URL';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_listing_view_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.viewer_id IS NOT NULL AND NEW.viewer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Invalid viewer identity';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS listing_views_identity ON public.listing_views;
CREATE TRIGGER listing_views_identity
BEFORE INSERT ON public.listing_views
FOR EACH ROW EXECUTE FUNCTION public.validate_listing_view_identity();
REVOKE ALL ON FUNCTION public.validate_listing_view_identity() FROM PUBLIC, anon, authenticated;
