-- VELORA v3: all new marketplace pricing is denominated in USD.
-- Historical rows are deliberately not converted: conversion requires a dated FX rate and must not silently change prices.
-- Existing non-USD active listings are moved to pending review before new USD-only triggers are installed.
UPDATE public.listings SET status = 'pending', review_note = 'VELORA USD migration: review and reprice this legacy non-USD listing before publication.' WHERE upper(coalesce(currency, '')) <> 'USD' AND status = 'active';
CREATE OR REPLACE FUNCTION public.enforce_velora_usd_currency()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF upper(coalesce(NEW.currency, '')) <> 'USD' THEN
    RAISE EXCEPTION 'VELORA supports USD-denominated marketplace prices only' USING ERRCODE = '22023';
  END IF;
  NEW.currency := 'USD';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS velora_listings_usd_currency ON public.listings;
CREATE TRIGGER velora_listings_usd_currency BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.enforce_velora_usd_currency();

DROP TRIGGER IF EXISTS velora_variants_usd_currency ON public.product_variants;
CREATE TRIGGER velora_variants_usd_currency BEFORE INSERT OR UPDATE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.enforce_velora_usd_currency();

-- Requests use the same marketplace currency where the schema has a currency field.
DO $$ BEGIN
  IF to_regclass('public.website_requests') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS velora_website_requests_usd_currency ON public.website_requests';
    EXECUTE 'CREATE TRIGGER velora_website_requests_usd_currency BEFORE INSERT OR UPDATE OF currency ON public.website_requests FOR EACH ROW EXECUTE FUNCTION public.enforce_velora_usd_currency()';
  END IF;
END $$;

-- Publishing requires a completed clean scan for every uploaded delivery asset.
-- This prevents an unconfigured/failed scanner from silently allowing delivery.
CREATE OR REPLACE FUNCTION public.enforce_listing_moderation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asset_count INTEGER;
  detail_count INTEGER;
  clean_asset_count INTEGER;
  unsafe_scan_count INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'pending';
    ELSIF NEW.status = 'active' THEN
      NEW.status := 'pending';
    END IF;
  END IF;

  IF NEW.status = 'active' THEN
    SELECT count(*) INTO asset_count FROM public.listing_assets WHERE listing_id = NEW.id;
    SELECT count(*) INTO detail_count FROM public.listing_product_details WHERE listing_id = NEW.id;
    IF asset_count < 1 OR detail_count < 1 OR NEW.cover_url IS NULL OR length(trim(NEW.cover_url)) < 8 THEN
      RAISE EXCEPTION 'Listing cannot be published until Product Studio details, cover media, and at least one delivery asset exist';
    END IF;

    SELECT count(DISTINCT asset_id) INTO clean_asset_count
      FROM public.malware_scans WHERE listing_id = NEW.id AND status = 'clean' AND asset_id IS NOT NULL;
    SELECT count(*) INTO unsafe_scan_count
      FROM public.malware_scans WHERE listing_id = NEW.id AND status <> 'clean';
    IF clean_asset_count < asset_count OR unsafe_scan_count > 0 THEN
      RAISE EXCEPTION 'Listing cannot be published until every delivery asset has a clean malware scan';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_listing_moderation_guard() FROM PUBLIC, anon, authenticated;

-- Reapply this policy in the new migration as well, so already-deployed databases
-- receive the fix without needing to rerun an older migration.
DROP POLICY IF EXISTS "product updates readable" ON public.product_updates;
CREATE POLICY "product updates readable" ON public.product_updates FOR SELECT
USING (
  auth.uid() IN (SELECT seller_id FROM public.listings WHERE id = listing_id)
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.listing_id = product_updates.listing_id
      AND o.buyer_id = auth.uid()
      AND o.status = 'completed'
  )
);
