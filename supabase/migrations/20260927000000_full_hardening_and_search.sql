-- VELORA 2.4.1: final hardening + marketplace search suggestions.
-- Provider-owned financial/KYC state is server authoritative. Search suggestions
-- use catalog data plus anonymized aggregate query popularity.

-- ---------------------------------------------------------------------------
-- Financial / KYC authority
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.seller_payment_accounts FROM anon, authenticated;
DROP POLICY IF EXISTS "seller payment account owner" ON public.seller_payment_accounts;
-- No client policy: only service_role/server functions can read or mutate
-- provider account identifiers and provider capability state.

REVOKE INSERT, UPDATE, DELETE ON public.seller_verifications FROM authenticated;
DROP POLICY IF EXISTS "seller verification owner" ON public.seller_verifications;
CREATE POLICY "seller verification read own" ON public.seller_verifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

REVOKE INSERT, UPDATE, DELETE ON public.seller_verification_documents FROM authenticated;
DROP POLICY IF EXISTS "verification docs owner admin" ON public.seller_verification_documents;
CREATE POLICY "verification docs read own" ON public.seller_verification_documents
  FOR SELECT TO authenticated
  USING (
    verification_id IN (SELECT id FROM public.seller_verifications WHERE user_id = auth.uid())
    OR public.has_role(auth.uid(),'admin')
  );

REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM authenticated;
DROP POLICY IF EXISTS "subscription owner" ON public.subscriptions;
CREATE POLICY "subscription read own" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Email queue is an internal operation. Client users never get direct access.
REVOKE ALL ON public.email_outbox FROM anon, authenticated;
GRANT ALL ON public.email_outbox TO service_role;

-- ---------------------------------------------------------------------------
-- Active-listing child edits must go back through moderation.
-- Service-role/admin moderation remains the trusted publish path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_active_listing_child_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  listing_uuid UUID;
  current_status TEXT;
BEGIN
  listing_uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.listing_id ELSE NEW.listing_id END;
  SELECT status INTO current_status FROM public.listings WHERE id = listing_uuid;

  IF current_status = 'active' AND COALESCE(auth.role(), '') <> 'service_role' AND NOT public.has_role(auth.uid(), 'admin') THEN
    UPDATE public.listings
    SET status = 'pending', review_note = 'Listing content changed and requires moderation review.'
    WHERE id = listing_uuid AND status = 'active';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS listing_product_details_moderation_guard ON public.listing_product_details;
CREATE TRIGGER listing_product_details_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.listing_product_details
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

DROP TRIGGER IF EXISTS listing_media_moderation_guard ON public.listing_media;
CREATE TRIGGER listing_media_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.listing_media
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

DROP TRIGGER IF EXISTS listing_assets_moderation_guard ON public.listing_assets;
CREATE TRIGGER listing_assets_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.listing_assets
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

DROP TRIGGER IF EXISTS listing_faq_moderation_guard ON public.listing_faq;
CREATE TRIGGER listing_faq_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.listing_faq
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

DROP TRIGGER IF EXISTS product_variants_moderation_guard ON public.product_variants;
CREATE TRIGGER product_variants_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

REVOKE ALL ON FUNCTION public.enforce_active_listing_child_moderation() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Search query suggestions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.search_query_stats (
  normalized_query TEXT PRIMARY KEY,
  display_query TEXT NOT NULL,
  search_count BIGINT NOT NULL DEFAULT 0 CHECK (search_count >= 0),
  last_searched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.search_query_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.search_query_stats FROM anon, authenticated;
GRANT ALL ON public.search_query_stats TO service_role;

CREATE OR REPLACE FUNCTION public.record_search_query(p_query TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE normalized TEXT := lower(regexp_replace(trim(coalesce(p_query, '')), '[[:space:]]+', ' ', 'g'));
BEGIN
  IF length(normalized) < 2 OR length(normalized) > 80 THEN RETURN; END IF;
  IF normalized ~ '[<>]' OR normalized ~ '@' OR normalized ~* 'https?://' OR normalized ~ '^[0-9 +().-]{7,}$' THEN RETURN; END IF;
  INSERT INTO public.search_query_stats(normalized_query, display_query, search_count, last_searched_at)
  VALUES (normalized, trim(p_query), 1, now())
  ON CONFLICT (normalized_query) DO UPDATE SET
    display_query = EXCLUDED.display_query,
    search_count = search_query_stats.search_count + 1,
    last_searched_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.record_search_query(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_search_query(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_listing_ids(p_query TEXT, p_limit INTEGER DEFAULT 500)
RETURNS TABLE(listing_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT l.id
  FROM listings l
  LEFT JOIN listing_product_details d ON d.listing_id = l.id
  LEFT JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(d.tags) = 'array' THEN d.tags ELSE '[]'::jsonb END
  ) tag(value) ON true
  WHERE l.status = 'active'
    AND length(trim(coalesce(p_query, ''))) >= 2
    AND (
      l.title ILIKE '%' || trim(p_query) || '%'
      OR coalesce(l.description, '') ILIKE '%' || trim(p_query) || '%'
      OR coalesce(l.category, '') ILIKE '%' || trim(p_query) || '%'
      OR tag.value ILIKE '%' || trim(p_query) || '%'
    )
  ORDER BY l.id
  LIMIT least(greatest(coalesce(p_limit, 500), 1), 500);
$$;
REVOKE ALL ON FUNCTION public.search_listing_ids(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_listing_ids(TEXT, INTEGER) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_suggestions(p_query TEXT, p_limit INTEGER DEFAULT 10)
RETURNS TABLE(
  suggestion_type TEXT,
  label TEXT,
  listing_id UUID,
  category TEXT,
  price NUMERIC,
  currency TEXT,
  popularity BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT lower(trim(coalesce(p_query, ''))) AS q, least(greatest(coalesce(p_limit, 10), 1), 12) AS lim
  ),
  query_hits AS (
    SELECT 'query'::TEXT AS suggestion_type, s.display_query AS label, NULL::UUID AS listing_id,
           NULL::TEXT AS category, NULL::NUMERIC AS price, NULL::TEXT AS currency, s.search_count AS popularity
    FROM search_query_stats s, params p
    WHERE length(p.q) >= 2 AND s.normalized_query LIKE '%' || p.q || '%'
    ORDER BY s.search_count DESC, s.last_searched_at DESC
    LIMIT 4
  ),
  product_hits AS (
    SELECT DISTINCT ON (l.id)
      'product'::TEXT, l.title, l.id, l.category, l.price, l.currency, l.sales_count::BIGINT
    FROM listings l, params p
    WHERE l.status = 'active'
      AND length(p.q) >= 2
      AND (l.title ILIKE '%' || p.q || '%' OR coalesce(l.description, '') ILIKE '%' || p.q || '%')
    ORDER BY l.id, l.sales_count DESC, l.created_at DESC
    LIMIT 5
  ),
  category_hits AS (
    SELECT 'category'::TEXT, l.category, NULL::UUID, l.category, NULL::NUMERIC, NULL::TEXT,
           count(*)::BIGINT
    FROM listings l, params p
    WHERE l.status = 'active' AND l.category IS NOT NULL AND length(p.q) >= 2
      AND l.category ILIKE '%' || p.q || '%'
    GROUP BY l.category
    ORDER BY count(*) DESC, l.category
    LIMIT 3
  ),
  tag_hits AS (
    SELECT 'tag'::TEXT, lower(tag.value), NULL::UUID, NULL::TEXT, NULL::NUMERIC, NULL::TEXT, count(*)::BIGINT
    FROM listing_product_details d
    JOIN listings l ON l.id = d.listing_id
    CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.tags) = 'array' THEN d.tags ELSE '[]'::jsonb END) tag(value)
    CROSS JOIN params p
    WHERE l.status = 'active' AND length(p.q) >= 2 AND tag.value ILIKE '%' || p.q || '%'
    GROUP BY lower(tag.value)
    ORDER BY count(*) DESC, lower(tag.value)
    LIMIT 4
  )
  SELECT * FROM query_hits
  UNION ALL SELECT * FROM product_hits
  UNION ALL SELECT * FROM category_hits
  UNION ALL SELECT * FROM tag_hits
  LIMIT (SELECT lim FROM params);
$$;
REVOKE ALL ON FUNCTION public.search_suggestions(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_suggestions(TEXT, INTEGER) TO anon, authenticated;

-- Coupon redemption counter is incremented only when a new redemption row is
-- actually inserted. This keeps counters consistent under webhook retries.
CREATE OR REPLACE FUNCTION public.consume_coupon(p_coupon_id UUID, p_buyer_id UUID, p_order_id UUID, p_amount NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inserted_count INTEGER;
BEGIN
  INSERT INTO public.coupon_redemptions(coupon_id, buyer_id, order_id, amount)
  VALUES (p_coupon_id, p_buyer_id, p_order_id, p_amount)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count = 1 THEN
    UPDATE public.coupons
    SET redeemed_count = redeemed_count + 1
    WHERE id = p_coupon_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_coupon(UUID, UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_coupon(UUID, UUID, UUID, NUMERIC) TO service_role;

-- Server-side normalization for seller-entered tags. The UI already prevents
-- duplicates, but the database must enforce the same basic shape for direct API clients.
CREATE OR REPLACE FUNCTION public.normalize_listing_product_tags()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE cleaned JSONB;
BEGIN
  IF jsonb_typeof(NEW.tags) <> 'array' THEN
    RAISE EXCEPTION 'Tags must be an array';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(tag) ORDER BY lower(tag)), '[]'::jsonb)
  INTO cleaned
  FROM (
    SELECT DISTINCT lower(left(trim(value), 48)) AS tag
    FROM jsonb_array_elements_text(NEW.tags) AS e(value)
    WHERE length(trim(value)) BETWEEN 1 AND 48
    LIMIT 12
  ) normalized;
  NEW.tags := cleaned;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_listing_product_tags ON public.listing_product_details;
CREATE TRIGGER normalize_listing_product_tags
BEFORE INSERT OR UPDATE OF tags ON public.listing_product_details
FOR EACH ROW EXECUTE FUNCTION public.normalize_listing_product_tags();
REVOKE ALL ON FUNCTION public.normalize_listing_product_tags() FROM PUBLIC, anon, authenticated;

-- Other seller-authored listing content also re-enters moderation when an
-- already-active listing is changed.
DROP TRIGGER IF EXISTS product_updates_moderation_guard ON public.product_updates;
CREATE TRIGGER product_updates_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.product_updates
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

DROP TRIGGER IF EXISTS listing_versions_moderation_guard ON public.listing_versions;
CREATE TRIGGER listing_versions_moderation_guard
AFTER INSERT OR UPDATE OR DELETE ON public.listing_versions
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_listing_child_moderation();

-- The private profiles table contains account email addresses. Public creator
-- cards use public_profiles, so the base table should not be globally readable.
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
DROP POLICY IF EXISTS "profiles readable by all" ON public.profiles;
CREATE POLICY "users read own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
