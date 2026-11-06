-- NORDEVA Shield: production malware-scanning pipeline support (2026-11-06).
--
-- What this does:
--  1. Widens the malware_scans status vocabulary for the new scanner's
--     verdicts: warning / incomplete / overridden join queued/clean/infected/
--     error/skipped.
--  2. Adds security_events, an append-only audit table for scan verdicts and
--     admin security decisions (writes happen only via SECURITY DEFINER RPCs
--     and the service role; admins can read, nobody can update or delete
--     through the API).
--  3. Strengthens the listing moderation guard: on top of the existing
--     'infected' veto, a listing whose latest completed scan (per delivery
--     asset) is warning / incomplete / error is held from (re)activation
--     until an admin overrides the hold after review. Listings with no
--     completed scans are NOT held — the owner's 2026-11-02 anti-deadlock
--     decision still stands for the unconfigured case.
--  4. Adds admin RPCs: admin_override_scan (release a hold after review) and
--     admin_rescan_listing (queue a fresh scan of every asset).

-- 1. Status vocabulary -------------------------------------------------------
ALTER TABLE public.malware_scans DROP CONSTRAINT IF EXISTS malware_scans_status_check;
ALTER TABLE public.malware_scans
  ADD CONSTRAINT malware_scans_status_check
  CHECK (status IN ('queued','scanning','clean','warning','infected','incomplete','overridden','error','skipped'));

-- 2. Append-only security audit log ------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
  asset_id UUID REFERENCES public.listing_assets(id) ON DELETE SET NULL,
  scan_id UUID REFERENCES public.malware_scans(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_events_listing_idx
  ON public.security_events(listing_id, created_at DESC);
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_events FROM anon, authenticated;
GRANT SELECT ON public.security_events TO authenticated;
GRANT ALL ON public.security_events TO service_role;
DROP POLICY IF EXISTS "admins read security events" ON public.security_events;
CREATE POLICY "admins read security events" ON public.security_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 3. Guard: security holds on activation --------------------------------------
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
  hold_scan_count INTEGER;
  check_holds BOOLEAN;
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

    -- Confirmed-malicious veto (unchanged from 2026-11-02): any infected
    -- scan row blocks publication, for every role, at any time.
    SELECT count(*) INTO infected_scan_count
      FROM public.malware_scans WHERE listing_id = NEW.id AND status = 'infected';
    IF infected_scan_count > 0 THEN
      RAISE EXCEPTION 'Listing cannot be published: a delivery asset failed its malware scan';
    END IF;

    -- Security holds: only when a listing is being (re)activated, so edits
    -- to an already-live listing are never trapped by a later scan.
    IF TG_OP = 'INSERT' THEN
      check_holds := TRUE;
    ELSIF OLD.status IS DISTINCT FROM 'active' THEN
      check_holds := TRUE;
    ELSE
      check_holds := FALSE;
    END IF;

    IF check_holds THEN
      -- Per delivery asset, look at the latest COMPLETED scan. A latest
      -- verdict of warning / incomplete / error means a human must review
      -- before this can go live (an admin override flips that row to
      -- 'overridden', which releases the hold). Assets with no completed
      -- scan do not hold the listing: no scanner configured must never
      -- deadlock publishing (owner decision, 2026-11-02).
      SELECT count(*) INTO hold_scan_count
        FROM public.listing_assets a
       WHERE a.listing_id = NEW.id
         AND (
           SELECT s.status
             FROM public.malware_scans s
            WHERE s.asset_id = a.id
              AND s.status IN ('clean','warning','infected','incomplete','overridden','error')
            ORDER BY s.scanned_at DESC
            LIMIT 1
         ) IN ('warning','incomplete','error');
      IF hold_scan_count > 0 THEN
        RAISE EXCEPTION 'Listing cannot be published: a delivery asset is on security hold (scan warning, incomplete or errored). An admin must review it under Security and override the hold first.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 4a. Admin: override a security hold after manual review ---------------------
CREATE OR REPLACE FUNCTION public.admin_override_scan(p_scan_id UUID, p_note TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scan public.malware_scans%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  SELECT * INTO v_scan FROM public.malware_scans WHERE id = p_scan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scan not found';
  END IF;
  IF v_scan.status NOT IN ('warning','incomplete','error') THEN
    RAISE EXCEPTION 'Only warning, incomplete or errored scans can be overridden (current: %)', v_scan.status;
  END IF;

  UPDATE public.malware_scans
     SET status = 'overridden',
         findings = COALESCE(findings, '{}'::jsonb) || jsonb_build_object(
           'admin_override', jsonb_build_object(
             'by', auth.uid(),
             'at', now(),
             'note', COALESCE(p_note, ''),
             'previous_status', v_scan.status
           )
         )
   WHERE id = p_scan_id;

  INSERT INTO public.security_events(listing_id, asset_id, scan_id, event_type, actor_id, detail)
  VALUES (v_scan.listing_id, v_scan.asset_id, v_scan.id, 'scan_overridden', auth.uid(),
          jsonb_build_object('note', COALESCE(p_note, ''), 'previous_status', v_scan.status));

  RETURN 'overridden';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_override_scan(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_override_scan(UUID, TEXT) TO authenticated;

-- 4b. Admin: queue a fresh scan of every asset of a listing -------------------
CREATE OR REPLACE FUNCTION public.admin_rescan_listing(p_listing_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_count INTEGER := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  INSERT INTO public.malware_scans(listing_id, asset_id, scanner, status, findings)
  SELECT a.listing_id, a.id, 'nordeva-shield', 'queued',
         jsonb_build_object('source', 'admin-rescan')
    FROM public.listing_assets a
   WHERE a.listing_id = p_listing_id
  ON CONFLICT (asset_id, scanner) DO UPDATE
     SET status = 'queued',
         scanned_at = now(),
         signature = NULL,
         findings = jsonb_build_object('source', 'admin-rescan');

  GET DIAGNOSTICS queued_count = ROW_COUNT;

  INSERT INTO public.security_events(listing_id, event_type, actor_id, detail)
  VALUES (p_listing_id, 'rescan_queued', auth.uid(),
          jsonb_build_object('assets_queued', queued_count));

  RETURN queued_count;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_rescan_listing(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rescan_listing(UUID) TO authenticated;
