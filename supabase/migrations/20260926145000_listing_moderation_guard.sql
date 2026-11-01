-- Marketplace upload/moderation hardening.
-- Sellers may submit products, but cannot self-publish or silently edit an active
-- listing without sending it back through moderation.

CREATE OR REPLACE FUNCTION public.enforce_listing_moderation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asset_count INTEGER;
  detail_count INTEGER;
BEGIN
  -- Service-role server actions are the trusted moderation path.
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'pending';
    ELSIF NEW.status = 'active' THEN
      NEW.status := 'pending';
    END IF;
  END IF;

  -- A trusted publish action still has to satisfy the minimum Product Studio
  -- delivery requirements. This prevents an admin/API bug from publishing an
  -- empty or non-deliverable product.
  IF NEW.status = 'active' THEN
    SELECT count(*) INTO asset_count
    FROM public.listing_assets
    WHERE listing_id = NEW.id;

    SELECT count(*) INTO detail_count
    FROM public.listing_product_details
    WHERE listing_id = NEW.id;

    IF asset_count < 1 OR detail_count < 1 OR NEW.cover_url IS NULL OR length(trim(NEW.cover_url)) < 8 THEN
      RAISE EXCEPTION 'Listing cannot be published until Product Studio details, cover media, and at least one delivery asset exist';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listings_moderation_guard ON public.listings;
CREATE TRIGGER listings_moderation_guard
BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.enforce_listing_moderation_guard();

REVOKE ALL ON FUNCTION public.enforce_listing_moderation_guard() FROM PUBLIC, anon, authenticated;

-- Seller-safe scan queue RPC: clients can request a scan queue without gaining
-- direct INSERT access to the operational malware_scans table.
CREATE OR REPLACE FUNCTION public.queue_listing_scans(p_listing_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  IF NOT (auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = p_listing_id) OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Not allowed to queue scans for this listing';
  END IF;

  INSERT INTO public.malware_scans(listing_id, asset_id, scanner, status, findings)
  SELECT a.listing_id, a.id, 'production-adapter', 'queued', jsonb_build_object('source','product-studio-upload')
  FROM public.listing_assets a
  WHERE a.listing_id = p_listing_id
  ON CONFLICT (asset_id, scanner) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.queue_listing_scans(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.queue_listing_scans(UUID) FROM anon;
