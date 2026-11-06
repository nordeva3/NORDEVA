-- Owner decision (2026-11-02): no malware scanner is configured, and requiring
-- a 'clean' verdict from a scanner that does not exist deadlocks ALL publishing.
-- Admin manual moderation is the publishing gate; scanner verdicts now act as a
-- veto only: an 'infected' verdict (the only bad verdict the worker writes)
-- blocks publication, queued/clean/absent scans do not.
CREATE OR REPLACE FUNCTION public.enforce_listing_moderation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asset_count INTEGER;
  detail_count INTEGER;
  infected_scan_count INTEGER;
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

    SELECT count(*) INTO infected_scan_count
      FROM public.malware_scans WHERE listing_id = NEW.id AND status = 'infected';
    IF infected_scan_count > 0 THEN
      RAISE EXCEPTION 'Listing cannot be published: a delivery asset failed its malware scan';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
