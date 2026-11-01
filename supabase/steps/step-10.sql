-- ============================================================
-- NORDEVA setup - STEP 10 of 11
-- Is step ko poora copy karke Supabase SQL Editor me Run karo.
-- ============================================================

-- ===== 20261101120000_ecosystem_upgrade.sql =====
-- VELORA ecosystem upgrade — Wave M1 (additive only, data-preserving).
--
-- Contents:
--   1. BUG FIX: select_project_proposal() now records the agreed amount so
--      project checkout (createProjectCheckout) can actually run.
--   2. Direct messages: revive the dormant conversations/messages schema
--      from 20260926090000 (one general conversation per user pair,
--      last_message_at maintenance, DM notifications), user_blocks with
--      send-time enforcement, and profile/message reporting.
--   3. project_disputes: a reviewable dispute record with a reason.
--   4. Revision-limit bookkeeping columns on website_requests (limit 2).
--   5. notifications.href for deep links.
--   6. profiles.services (+ public_profiles mirror).
--   7. project_status: allow 'resubmitted' and 'payment_released', with the
--      matching transition_project_status() graph additions.
--
-- Everything is guarded (IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR
-- REPLACE) so the file can run once over a partially migrated database.

-- ==========================================================================
-- 1. select_project_proposal: record the agreed amount (BUG FIX)
-- ==========================================================================
-- createProjectCheckout (src/lib/project-payment.functions.ts) requires
-- website_requests.agreed_amount > 0, but nothing ever wrote it, so project
-- checkout always threw "The project amount has not been agreed yet".
-- proposed_amount and agreed_amount are both major-unit NUMERIC(12,2)
-- (e.g. 150.00 = $150); the checkout applies the 85/15 breakdown and
-- converts to minor units itself. The function body below is the
-- 20261031120000 definition with only the website_requests UPDATE extended.
CREATE OR REPLACE FUNCTION public.select_project_proposal(p_request_id UUID, p_proposal_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.website_requests%ROWTYPE;
  v_proposal public.project_proposals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_request FROM public.website_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Website request not found';
  END IF;

  IF v_request.requester_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only the request owner can select a proposal';
  END IF;

  -- Mirror the claim guard: an already-taken request cannot be re-assigned.
  IF v_request.taken_by IS NOT NULL OR v_request.status <> 'open' THEN
    RAISE EXCEPTION 'Request is no longer open for selection';
  END IF;

  SELECT * INTO v_proposal FROM public.project_proposals
  WHERE id = p_proposal_id AND request_id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found for this request';
  END IF;

  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'Proposal is not pending';
  END IF;

  IF v_proposal.developer_id = v_request.requester_id THEN
    RAISE EXCEPTION 'A requester cannot be selected for their own request';
  END IF;

  -- Reject the other pending proposals first so the one-accepted partial
  -- unique index can never be violated mid-flight.
  UPDATE public.project_proposals
  SET status = 'rejected', updated_at = now()
  WHERE request_id = p_request_id AND status = 'pending' AND id <> p_proposal_id;

  UPDATE public.project_proposals
  SET status = 'accepted', updated_at = now()
  WHERE id = p_proposal_id;

  UPDATE public.website_requests
  SET status = 'taken',
      taken_by = v_proposal.developer_id,
      taken_at = now(),
      selected_proposal_id = p_proposal_id,
      project_status = 'developer_selected',
      -- Agreed price = the accepted proposal's amount (major units). The
      -- platform is USD-only (20261028010000), so the agreed currency is
      -- stamped 'USD' rather than trusting the proposal row's currency.
      agreed_amount = v_proposal.proposed_amount,
      agreed_currency = 'USD',
      is_draft = false,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.select_project_proposal(UUID, UUID) TO authenticated;

-- ==========================================================================
-- 2. Notifications deep links (needed by the DM notification trigger below)
-- ==========================================================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS href TEXT;

-- ==========================================================================
-- 3. Direct messages on the dormant conversations/messages schema
-- ==========================================================================
-- conversations.last_message_at already exists (20260926090000); the ADD
-- COLUMN is a guarded no-op that documents the dependency.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- One general (listing-less) conversation per user pair. The table's
-- UNIQUE(listing_id, buyer_id, seller_id) cannot enforce this because
-- Postgres treats NULL listing_id values as distinct, and the pair could
-- be stored in either direction — so the index is on the normalised
-- (least, greatest) pair, restricted to listing_id IS NULL rows. Listing
-- enquiry threads keep their existing uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_general_pair_unique
  ON public.conversations (LEAST(buyer_id, seller_id), GREATEST(buyer_id, seller_id))
  WHERE listing_id IS NULL;

-- Keep conversations.last_message_at current on every message.
CREATE OR REPLACE FUNCTION public.touch_conversation_last_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_touch_conversation_last_message ON public.messages;
CREATE TRIGGER trg_touch_conversation_last_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_last_message();

-- Notify the other participant of a new direct message (same trigger
-- pattern as the project notifications in Waves C/D, plus the new href).
CREATE OR REPLACE FUNCTION public.notify_direct_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recipient UUID;
  v_sender_name TEXT;
BEGIN
  SELECT CASE WHEN buyer_id = NEW.sender_id THEN seller_id ELSE buyer_id END
    INTO v_recipient
  FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_recipient IS NOT NULL AND v_recipient <> NEW.sender_id THEN
    SELECT display_name INTO v_sender_name
    FROM public.profiles WHERE id = NEW.sender_id;
    INSERT INTO public.notifications (user_id, title, body, href)
    VALUES (v_recipient, 'New message',
            'You have a new message from ' ||
              COALESCE(NULLIF(v_sender_name, ''), 'a NORDEVA member') || '.',
            '/messages/' || NEW.conversation_id::text);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_direct_message ON public.messages;
CREATE TRIGGER trg_notify_direct_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_direct_message();

-- --------------------------------------------------------------------------
-- user_blocks: a user manages only their own block list; either party can
-- read the pair row so clients can show "blocked / you blocked them".
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_no_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx
  ON public.user_blocks (blocked_id);
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;
DROP POLICY IF EXISTS "users read own block pairs" ON public.user_blocks;
CREATE POLICY "users read own block pairs" ON public.user_blocks
  FOR SELECT TO authenticated
  USING (auth.uid() = blocker_id OR auth.uid() = blocked_id);
DROP POLICY IF EXISTS "users block others" ON public.user_blocks;
CREATE POLICY "users block others" ON public.user_blocks
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = blocker_id);
DROP POLICY IF EXISTS "users unblock others" ON public.user_blocks;
CREATE POLICY "users unblock others" ON public.user_blocks
  FOR DELETE TO authenticated
  USING (auth.uid() = blocker_id);

-- Enforcement: a message insert fails when a block exists in either
-- direction between the sender and the other conversation participant.
CREATE OR REPLACE FUNCTION public.block_dm_when_blocked()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_other UUID;
BEGIN
  SELECT CASE WHEN buyer_id = NEW.sender_id THEN seller_id ELSE buyer_id END
    INTO v_other
  FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_other IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = NEW.sender_id AND blocked_id = v_other)
       OR (blocker_id = v_other AND blocked_id = NEW.sender_id)
  ) THEN
    RAISE EXCEPTION 'Messages are blocked between you and this user';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_block_dm_when_blocked ON public.messages;
CREATE TRIGGER trg_block_dm_when_blocked
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.block_dm_when_blocked();

-- --------------------------------------------------------------------------
-- reports: allow reporting a profile or a message, not just a listing.
-- listing_id becomes nullable and a CHECK keeps exactly one target set,
-- so existing listing reports keep working unchanged.
-- --------------------------------------------------------------------------
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS reported_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;
ALTER TABLE public.reports
  ALTER COLUMN listing_id DROP NOT NULL;
ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_single_target_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_single_target_check
  CHECK (
    (listing_id IS NOT NULL)::int
    + (reported_user_id IS NOT NULL)::int
    + (message_id IS NOT NULL)::int
    = 1
  );
CREATE INDEX IF NOT EXISTS reports_reported_user_idx
  ON public.reports (reported_user_id) WHERE reported_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reports_message_idx
  ON public.reports (message_id) WHERE message_id IS NOT NULL;

-- ==========================================================================
-- 4. project_disputes: a reviewable dispute record (reason + resolution)
-- ==========================================================================
-- Raising a dispute still flips the project to 'disputed' via
-- transition_project_status (M4 wires the UI); this table is the record an
-- admin reviews. No notification trigger here — that lands with M4/M6.
CREATE TABLE IF NOT EXISTS public.project_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  raised_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  admin_note TEXT,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_disputes_status_check
    CHECK (status IN ('open', 'resolved_buyer', 'resolved_developer', 'resolved_partial', 'closed'))
);
CREATE INDEX IF NOT EXISTS project_disputes_project_idx
  ON public.project_disputes (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_disputes_status_idx
  ON public.project_disputes (status, created_at DESC);
ALTER TABLE public.project_disputes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.project_disputes TO authenticated;
GRANT ALL ON public.project_disputes TO service_role;
DROP POLICY IF EXISTS "project participants read disputes" ON public.project_disputes;
CREATE POLICY "project participants read disputes" ON public.project_disputes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = project_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "project participants raise disputes" ON public.project_disputes;
CREATE POLICY "project participants raise disputes" ON public.project_disputes
  FOR INSERT TO authenticated
  WITH CHECK (
    raised_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = project_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "admins update disputes" ON public.project_disputes;
CREATE POLICY "admins update disputes" ON public.project_disputes
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS update_project_disputes_updated_at ON public.project_disputes;
CREATE TRIGGER update_project_disputes_updated_at
  BEFORE UPDATE ON public.project_disputes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==========================================================================
-- 5. Revision limit bookkeeping (enforcement lands in M4)
-- ==========================================================================
ALTER TABLE public.website_requests
  ADD COLUMN IF NOT EXISTS revision_limit INT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS revisions_used INT NOT NULL DEFAULT 0;

-- ==========================================================================
-- 6. profiles.services + public_profiles mirror (Wave B pattern)
-- ==========================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS services TEXT[] DEFAULT '{}';
ALTER TABLE public.public_profiles
  ADD COLUMN IF NOT EXISTS services TEXT[] DEFAULT '{}';

-- Backfill from profiles for existing rows.
UPDATE public.public_profiles pp
SET services = COALESCE(p.services, '{}')
FROM public.profiles p
WHERE pp.id = p.id;

-- The Wave B sync function, extended with the services column.
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
    id, display_name, username, avatar_url, bio, website_url, twitter_url, github_url,
    headline, cover_url, skills, languages, experience_level, years_experience,
    availability, hourly_rate, services, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.display_name, NEW.username, NEW.avatar_url, NEW.bio, NEW.website_url,
    NEW.twitter_url, NEW.github_url,
    NEW.headline, NEW.cover_url, COALESCE(NEW.skills, '{}'), COALESCE(NEW.languages, '{}'),
    NEW.experience_level, NEW.years_experience, NEW.availability, NEW.hourly_rate,
    COALESCE(NEW.services, '{}'), NEW.created_at, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    username = EXCLUDED.username,
    avatar_url = EXCLUDED.avatar_url,
    bio = EXCLUDED.bio,
    website_url = EXCLUDED.website_url,
    twitter_url = EXCLUDED.twitter_url,
    github_url = EXCLUDED.github_url,
    headline = EXCLUDED.headline,
    cover_url = EXCLUDED.cover_url,
    skills = EXCLUDED.skills,
    languages = EXCLUDED.languages,
    experience_level = EXCLUDED.experience_level,
    years_experience = EXCLUDED.years_experience,
    availability = EXCLUDED.availability,
    hourly_rate = EXCLUDED.hourly_rate,
    services = EXCLUDED.services,
    updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_public_profile() FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- 7. Statuses: 'resubmitted' and 'payment_released'
-- ==========================================================================
-- Transition-graph choice (kept minimal):
--   * revision_requested -> resubmitted: when the developer submits a new
--     delivery after a revision was requested, M4 moves the project to
--     'resubmitted' (same developer-only role rule as the other submission
--     states) instead of jumping straight back to a review state.
--   * resubmitted -> preview_submitted / final_submitted: from there the
--     project re-enters the existing review flow unchanged
--     (resubmitted -> disputed is also allowed, like every work state).
--   * completed -> payment_released: an admin-only marker that the manual
--     payout for a completed project has been settled (M5); the legacy
--     status column stays 'completed'.
ALTER TABLE public.website_requests
  DROP CONSTRAINT IF EXISTS website_requests_project_status_check;
ALTER TABLE public.website_requests
  ADD CONSTRAINT website_requests_project_status_check
  CHECK (project_status IS NULL OR project_status IN (
    'draft', 'pending_review', 'open', 'proposals_received',
    'developer_selected', 'awaiting_agreement', 'awaiting_payment',
    'in_progress', 'preview_submitted', 'revision_requested',
    'final_submitted', 'completed', 'cancelled', 'disputed', 'refunded',
    'resubmitted', 'payment_released'
  ));

-- The 20261031120000 transition function with only the graph/role deltas
-- described above (plus 'resubmitted' in the legacy-status sync list).
CREATE OR REPLACE FUNCTION public.transition_project_status(p_request_id UUID, p_status TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.website_requests%ROWTYPE;
  v_from TEXT;
  v_is_admin BOOLEAN;
  v_is_requester BOOLEAN;
  v_is_developer BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_status NOT IN (
    'draft', 'pending_review', 'open', 'proposals_received',
    'developer_selected', 'awaiting_agreement', 'awaiting_payment',
    'in_progress', 'preview_submitted', 'revision_requested',
    'final_submitted', 'completed', 'cancelled', 'disputed', 'refunded',
    'resubmitted', 'payment_released'
  ) THEN
    RAISE EXCEPTION 'Unknown project status: %', p_status;
  END IF;

  SELECT * INTO v_request FROM public.website_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Website request not found';
  END IF;

  v_is_admin := public.has_role(auth.uid(), 'admin');
  v_is_requester := v_request.requester_id = auth.uid();
  v_is_developer := v_request.taken_by IS NOT NULL AND v_request.taken_by = auth.uid();

  IF NOT (v_is_admin OR v_is_requester OR v_is_developer) THEN
    RAISE EXCEPTION 'Only project participants can change the project status';
  END IF;

  -- Effective current state: project_status when set, else derive from the
  -- legacy status used by rows created before this migration.
  v_from := COALESCE(v_request.project_status, CASE v_request.status
    WHEN 'open' THEN 'open'
    WHEN 'taken' THEN 'in_progress'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
  END);

  IF v_from = p_status THEN
    RETURN true; -- already there; idempotent no-op
  END IF;

  -- Allowed transition graph.
  IF NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('draft', 'pending_review'), ('draft', 'open'), ('draft', 'cancelled'),
      ('pending_review', 'open'), ('pending_review', 'draft'), ('pending_review', 'cancelled'),
      ('open', 'proposals_received'), ('open', 'developer_selected'), ('open', 'cancelled'),
      ('proposals_received', 'developer_selected'), ('proposals_received', 'open'), ('proposals_received', 'cancelled'),
      ('developer_selected', 'awaiting_agreement'), ('developer_selected', 'awaiting_payment'),
      ('developer_selected', 'in_progress'), ('developer_selected', 'cancelled'), ('developer_selected', 'disputed'),
      ('awaiting_agreement', 'awaiting_payment'), ('awaiting_agreement', 'in_progress'),
      ('awaiting_agreement', 'cancelled'), ('awaiting_agreement', 'disputed'),
      ('awaiting_payment', 'in_progress'), ('awaiting_payment', 'cancelled'), ('awaiting_payment', 'disputed'),
      ('in_progress', 'preview_submitted'), ('in_progress', 'final_submitted'),
      ('in_progress', 'cancelled'), ('in_progress', 'disputed'),
      ('preview_submitted', 'revision_requested'), ('preview_submitted', 'in_progress'),
      ('preview_submitted', 'final_submitted'), ('preview_submitted', 'disputed'),
      ('revision_requested', 'in_progress'), ('revision_requested', 'preview_submitted'), ('revision_requested', 'disputed'),
      ('revision_requested', 'resubmitted'),
      ('resubmitted', 'preview_submitted'), ('resubmitted', 'final_submitted'), ('resubmitted', 'disputed'),
      ('final_submitted', 'completed'), ('final_submitted', 'revision_requested'), ('final_submitted', 'disputed'),
      ('completed', 'disputed'), ('completed', 'refunded'), ('completed', 'payment_released'),
      ('disputed', 'in_progress'), ('disputed', 'completed'), ('disputed', 'cancelled'), ('disputed', 'refunded')
    ) AS t(f, tt)
    WHERE t.f = v_from AND t.tt = p_status
  ) THEN
    RAISE EXCEPTION 'Project status transition % -> % is not allowed', v_from, p_status;
  END IF;

  -- Role rules on top of the graph.
  IF p_status = 'refunded' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only an admin can mark a project refunded';
  END IF;
  IF p_status = 'payment_released' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only an admin can mark a project payment as released';
  END IF;
  IF p_status = 'cancelled' AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can cancel a project';
  END IF;
  IF p_status = 'completed' AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can approve completion';
  END IF;
  IF p_status = 'revision_requested' AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can request a revision';
  END IF;
  IF p_status IN ('preview_submitted', 'final_submitted', 'resubmitted') AND NOT (v_is_admin OR v_is_developer) THEN
    RAISE EXCEPTION 'Only the assigned developer can submit work';
  END IF;
  IF p_status IN ('draft', 'pending_review', 'open', 'proposals_received',
                  'awaiting_agreement', 'awaiting_payment')
     AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can move the project through this stage';
  END IF;
  IF p_status = 'in_progress' AND NOT (v_is_admin OR v_is_developer OR (v_is_requester AND v_from = 'awaiting_payment')) THEN
    RAISE EXCEPTION 'Only the assigned developer can move the project into progress';
  END IF;

  UPDATE public.website_requests
  SET project_status = p_status,
      is_draft = (p_status = 'draft'),
      status = CASE
        WHEN p_status = 'completed' THEN 'completed'
        WHEN p_status = 'cancelled' THEN 'cancelled'
        WHEN taken_by IS NOT NULL AND p_status IN (
          'developer_selected', 'awaiting_agreement', 'awaiting_payment',
          'in_progress', 'preview_submitted', 'revision_requested', 'final_submitted',
          'resubmitted'
        ) THEN 'taken'
        WHEN p_status IN ('open', 'proposals_received', 'pending_review') THEN 'open'
        ELSE status
      END,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transition_project_status(UUID, TEXT) TO authenticated;

-- ===== 20261101130000_wave_m4_delivery_approval.sql =====
-- VELORA ecosystem upgrade — Wave M4 (additive only, data-preserving).
--
-- project_deliveries: record WHEN the buyer approved a delivery.
-- Approval was previously only inferable from the delivery's
-- status = 'approved' plus the parent request's updated_at; approved_at
-- stamps the exact moment the buyer accepted a preview or the final
-- delivery in the workspace (set by the workspace approve action).
-- Guarded so the file can run once over a partially migrated database.

ALTER TABLE public.project_deliveries
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
