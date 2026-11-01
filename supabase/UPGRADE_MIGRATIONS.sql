-- ============================================================
-- FILE: supabase/migrations/20261031120000_marketplace_upgrade.sql
-- ============================================================
-- VELORA marketplace upgrade — Wave A (additive only).
--
-- Adds the data foundation for the master upgrade specification:
--   * categories (admin-managed product categories with subcategories)
--   * professional profile fields on profiles (headline, skills, portfolio…)
--   * rich package fields + fine-grained project_status on website_requests
--   * project_proposals (proposal flow replacing first-come claiming)
--   * project_milestones / project_deliveries / project_revisions (workspace)
--   * profile_portfolio, saved_developers
--   * RPCs: select_project_proposal(), transition_project_status()
--
-- Nothing is dropped or altered destructively. Existing columns, the legacy
-- website_requests.status flow ('open'/'taken'/'completed'/'cancelled') and
-- the claim/complete RPCs keep working; the new project_status column tracks
-- the 15-state project lifecycle alongside them.
--
-- User references follow the existing pattern (website_requests.requester_id):
-- FKs point at auth.users(id). Admin checks use public.has_role(uid, 'admin').

-- --------------------------------------------------------------------------
-- Categories
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS categories_parent_idx ON public.categories (parent_id, sort_order);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
DROP POLICY IF EXISTS "active categories are public" ON public.categories;
CREATE POLICY "active categories are public" ON public.categories FOR SELECT
  USING (is_active OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "admins manage categories" ON public.categories;
CREATE POLICY "admins manage categories" ON public.categories FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS update_categories_updated_at ON public.categories;
CREATE TRIGGER update_categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.categories (name, slug, sort_order) VALUES
  ('WordPress', 'wordpress', 1),
  ('PHP Scripts', 'php-scripts', 2),
  ('HTML Templates', 'html-templates', 3),
  ('Website Templates', 'website-templates', 4),
  ('Mobile Applications', 'mobile-applications', 5),
  ('UI Kits', 'ui-kits', 6),
  ('Plugins', 'plugins', 7),
  ('Graphics', 'graphics', 8),
  ('Themes', 'themes', 9),
  ('Software', 'software', 10),
  ('Other', 'other', 11)
ON CONFLICT (slug) DO NOTHING;

-- --------------------------------------------------------------------------
-- Professional profile fields on profiles
-- --------------------------------------------------------------------------
-- The existing profiles RLS ("users update own profile", auth.uid() = id)
-- already covers these columns; no policy changes are needed or made.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS headline TEXT,
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS experience_level TEXT,
  ADD COLUMN IF NOT EXISTS years_experience INTEGER,
  ADD COLUMN IF NOT EXISTS availability TEXT,
  ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);

-- --------------------------------------------------------------------------
-- Website requests: package fields + project lifecycle
-- --------------------------------------------------------------------------
ALTER TABLE public.website_requests
  ADD COLUMN IF NOT EXISTS package_type TEXT,
  ADD COLUMN IF NOT EXISTS required_pages TEXT,
  ADD COLUMN IF NOT EXISTS required_functionality TEXT,
  ADD COLUMN IF NOT EXISTS preferred_technologies TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS design_references TEXT,
  ADD COLUMN IF NOT EXISTS reference_urls TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS domain_needs TEXT,
  ADD COLUMN IF NOT EXISTS hosting_needs TEXT,
  ADD COLUMN IF NOT EXISTS deadline DATE,
  ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreed_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS agreed_currency TEXT,
  ADD COLUMN IF NOT EXISTS selected_proposal_id UUID,
  ADD COLUMN IF NOT EXISTS project_status TEXT;

-- project_status is NULL for legacy rows (derived from status by the RPCs);
-- when set it must be one of the 15 lifecycle states from the specification.
ALTER TABLE public.website_requests
  DROP CONSTRAINT IF EXISTS website_requests_project_status_check;
ALTER TABLE public.website_requests
  ADD CONSTRAINT website_requests_project_status_check
  CHECK (project_status IS NULL OR project_status IN (
    'draft', 'pending_review', 'open', 'proposals_received',
    'developer_selected', 'awaiting_agreement', 'awaiting_payment',
    'in_progress', 'preview_submitted', 'revision_requested',
    'final_submitted', 'completed', 'cancelled', 'disputed', 'refunded'
  ));
CREATE INDEX IF NOT EXISTS website_requests_project_status_idx
  ON public.website_requests (project_status, created_at DESC);

-- --------------------------------------------------------------------------
-- Project proposals
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  developer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  proposed_amount NUMERIC(12,2),
  currency TEXT NOT NULL DEFAULT 'USD',
  estimated_days INTEGER,
  portfolio_urls TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_proposals_request_idx
  ON public.project_proposals (request_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS project_proposals_developer_idx
  ON public.project_proposals (developer_id, created_at DESC);
-- A request can have at most one accepted proposal (single assignment), and a
-- developer can have at most one pending proposal per request.
CREATE UNIQUE INDEX IF NOT EXISTS project_proposals_one_accepted_idx
  ON public.project_proposals (request_id) WHERE status = 'accepted';
CREATE UNIQUE INDEX IF NOT EXISTS project_proposals_one_pending_per_dev_idx
  ON public.project_proposals (request_id, developer_id) WHERE status = 'pending';
ALTER TABLE public.project_proposals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_proposals TO authenticated;
GRANT ALL ON public.project_proposals TO service_role;
DROP POLICY IF EXISTS "proposal participants read" ON public.project_proposals;
CREATE POLICY "proposal participants read" ON public.project_proposals FOR SELECT
  TO authenticated
  USING (
    auth.uid() = developer_id
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "developers create proposals" ON public.project_proposals;
CREATE POLICY "developers create proposals" ON public.project_proposals FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = developer_id
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id <> auth.uid()
    )
  );
DROP POLICY IF EXISTS "proposal participants update" ON public.project_proposals;
CREATE POLICY "proposal participants update" ON public.project_proposals FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = developer_id
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = developer_id
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "developers delete own proposals" ON public.project_proposals;
CREATE POLICY "developers delete own proposals" ON public.project_proposals FOR DELETE
  TO authenticated
  USING (auth.uid() = developer_id OR public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS update_project_proposals_updated_at ON public.project_proposals;
CREATE TRIGGER update_project_proposals_updated_at
  BEFORE UPDATE ON public.project_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Now that project_proposals exists, link the selected proposal from the request.
ALTER TABLE public.website_requests
  DROP CONSTRAINT IF EXISTS website_requests_selected_proposal_fkey;
ALTER TABLE public.website_requests
  ADD CONSTRAINT website_requests_selected_proposal_fkey
  FOREIGN KEY (selected_proposal_id) REFERENCES public.project_proposals(id) ON DELETE SET NULL;

-- --------------------------------------------------------------------------
-- Project milestones
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'done')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_milestones_request_idx
  ON public.project_milestones (request_id, sort_order);
ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_milestones TO authenticated;
GRANT ALL ON public.project_milestones TO service_role;
DROP POLICY IF EXISTS "milestone participants read" ON public.project_milestones;
CREATE POLICY "milestone participants read" ON public.project_milestones FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "milestone participants insert" ON public.project_milestones;
CREATE POLICY "milestone participants insert" ON public.project_milestones FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "milestone participants update" ON public.project_milestones;
CREATE POLICY "milestone participants update" ON public.project_milestones FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "milestone participants delete" ON public.project_milestones;
CREATE POLICY "milestone participants delete" ON public.project_milestones FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP TRIGGER IF EXISTS update_project_milestones_updated_at ON public.project_milestones;
CREATE TRIGGER update_project_milestones_updated_at
  BEFORE UPDATE ON public.project_milestones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- --------------------------------------------------------------------------
-- Project deliveries (previews + final handovers)
-- --------------------------------------------------------------------------
-- Delivery files live in the existing private `listing-files` bucket; only
-- object paths are stored here, never public URLs (signed URLs are minted by
-- the app after an RLS/ownership check). No new bucket or storage policy is
-- required for this wave.
CREATE TABLE IF NOT EXISTS public.project_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('preview', 'final')),
  preview_url TEXT,
  final_url TEXT,
  file_paths TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'revision_requested')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_deliveries_request_idx
  ON public.project_deliveries (request_id, created_at DESC);
ALTER TABLE public.project_deliveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.project_deliveries TO authenticated;
GRANT ALL ON public.project_deliveries TO service_role;
DROP POLICY IF EXISTS "delivery participants read" ON public.project_deliveries;
CREATE POLICY "delivery participants read" ON public.project_deliveries FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "assigned developer submits deliveries" ON public.project_deliveries;
CREATE POLICY "assigned developer submits deliveries" ON public.project_deliveries FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = submitted_by
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.taken_by = auth.uid()
    )
  );
-- Requesters update a delivery to approve it or request a revision (the UI
-- only changes `status`; RLS scopes the row set, column narrowing happens in
-- the app/RPC layer). Admins can update for moderation.
DROP POLICY IF EXISTS "requester reviews deliveries" ON public.project_deliveries;
CREATE POLICY "requester reviews deliveries" ON public.project_deliveries FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id = auth.uid()
    )
  );

-- --------------------------------------------------------------------------
-- Project revisions
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  delivery_id UUID NOT NULL REFERENCES public.project_deliveries(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notes TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_revisions_request_idx
  ON public.project_revisions (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_revisions_delivery_idx
  ON public.project_revisions (delivery_id, created_at DESC);
ALTER TABLE public.project_revisions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.project_revisions TO authenticated;
GRANT ALL ON public.project_revisions TO service_role;
DROP POLICY IF EXISTS "revision participants read" ON public.project_revisions;
CREATE POLICY "revision participants read" ON public.project_revisions FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "requester creates revisions" ON public.project_revisions;
CREATE POLICY "requester creates revisions" ON public.project_revisions FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = requested_by
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id AND wr.requester_id = auth.uid()
    )
  );

-- --------------------------------------------------------------------------
-- Profile portfolio
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_portfolio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  image_url TEXT,
  technologies TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_portfolio_user_idx
  ON public.profile_portfolio (user_id, sort_order);
ALTER TABLE public.profile_portfolio ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profile_portfolio TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.profile_portfolio TO authenticated;
GRANT ALL ON public.profile_portfolio TO service_role;
DROP POLICY IF EXISTS "portfolio is public" ON public.profile_portfolio;
CREATE POLICY "portfolio is public" ON public.profile_portfolio FOR SELECT USING (true);
DROP POLICY IF EXISTS "owner manages portfolio" ON public.profile_portfolio;
CREATE POLICY "owner manages portfolio" ON public.profile_portfolio FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS update_profile_portfolio_updated_at ON public.profile_portfolio;
CREATE TRIGGER update_profile_portfolio_updated_at
  BEFORE UPDATE ON public.profile_portfolio
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- --------------------------------------------------------------------------
-- Saved developers
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saved_developers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  developer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, developer_id)
);
CREATE INDEX IF NOT EXISTS saved_developers_developer_idx
  ON public.saved_developers (developer_id);
ALTER TABLE public.saved_developers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.saved_developers TO authenticated;
GRANT ALL ON public.saved_developers TO service_role;
DROP POLICY IF EXISTS "users manage own saved developers" ON public.saved_developers;
CREATE POLICY "users manage own saved developers" ON public.saved_developers FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND user_id <> developer_id);

-- --------------------------------------------------------------------------
-- RPC: select a proposal (mirrors the claim flow's status semantics)
-- --------------------------------------------------------------------------
-- claim_website_request() sets status='taken', taken_by and taken_at. This
-- RPC does exactly the same once the requester picks a proposal, and also
-- records selected_proposal_id and project_status='developer_selected'.
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
      is_draft = false,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.select_project_proposal(UUID, UUID) TO authenticated;

-- --------------------------------------------------------------------------
-- RPC: validated project status transitions
-- --------------------------------------------------------------------------
-- project_status is the fine-grained lifecycle from the specification; the
-- legacy status column is kept in sync ('open'/'taken'/'completed'/
-- 'cancelled') so existing pages keep working.
--
-- Role rules (pragmatic):
--   * admin       — any allowed transition.
--   * requester   — submission flow (draft/pending_review/open), marking
--                   proposals received, agreement/payment stages, revision
--                   requests, approval to completed, cancel, dispute.
--   * developer   — work flow (in_progress, preview/final submitted),
--                   dispute. The developer cannot cancel or mark completed.
--   * refunded    — admin only.
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
    'final_submitted', 'completed', 'cancelled', 'disputed', 'refunded'
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
      ('final_submitted', 'completed'), ('final_submitted', 'revision_requested'), ('final_submitted', 'disputed'),
      ('completed', 'disputed'), ('completed', 'refunded'),
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
  IF p_status = 'cancelled' AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can cancel a project';
  END IF;
  IF p_status = 'completed' AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can approve completion';
  END IF;
  IF p_status = 'revision_requested' AND NOT (v_is_admin OR v_is_requester) THEN
    RAISE EXCEPTION 'Only the requester or an admin can request a revision';
  END IF;
  IF p_status IN ('preview_submitted', 'final_submitted') AND NOT (v_is_admin OR v_is_developer) THEN
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
          'in_progress', 'preview_submitted', 'revision_requested', 'final_submitted'
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

-- ============================================================
-- FILE: supabase/migrations/20261031130000_wave_b_public_profiles.sql
-- ============================================================
-- VELORA marketplace upgrade — Wave B (additive only).
--
-- Expose the professional profile fields (added to profiles by Wave A) on
-- public_profiles so public creator pages can show headline, skills,
-- languages, experience, availability and hourly rate. public_profiles is
-- the public-safe mirror of profiles (see 20260918050000_production_hardening);
-- profiles itself stays readable only by its owner/admins, and the profile
-- completion percentage is NEVER copied here — it is owner-only by design.
--
-- The sync trigger function is extended with the new columns; the separate
-- verified-status sync (seller_verifications based) is untouched.

ALTER TABLE public.public_profiles
  ADD COLUMN IF NOT EXISTS headline TEXT,
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS experience_level TEXT,
  ADD COLUMN IF NOT EXISTS years_experience INTEGER,
  ADD COLUMN IF NOT EXISTS availability TEXT,
  ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);

-- Backfill from profiles for existing rows.
UPDATE public.public_profiles pp
SET headline = p.headline,
    cover_url = p.cover_url,
    skills = COALESCE(p.skills, '{}'),
    languages = COALESCE(p.languages, '{}'),
    experience_level = p.experience_level,
    years_experience = p.years_experience,
    availability = p.availability,
    hourly_rate = p.hourly_rate
FROM public.profiles p
WHERE pp.id = p.id;

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
    availability, hourly_rate, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.display_name, NEW.username, NEW.avatar_url, NEW.bio, NEW.website_url,
    NEW.twitter_url, NEW.github_url,
    NEW.headline, NEW.cover_url, COALESCE(NEW.skills, '{}'), COALESCE(NEW.languages, '{}'),
    NEW.experience_level, NEW.years_experience, NEW.availability, NEW.hourly_rate,
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
    headline = EXCLUDED.headline,
    cover_url = EXCLUDED.cover_url,
    skills = EXCLUDED.skills,
    languages = EXCLUDED.languages,
    experience_level = EXCLUDED.experience_level,
    years_experience = EXCLUDED.years_experience,
    availability = EXCLUDED.availability,
    hourly_rate = EXCLUDED.hourly_rate,
    updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_public_profile() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- FILE: supabase/migrations/20261031140000_wave_c_projects.sql
-- ============================================================
-- VELORA marketplace upgrade — Wave C (additive only).
--
-- Supports the custom website projects marketplace UI:
--   * website_requests gains the remaining request-form fields from the
--     specification (category, website purpose, target audience).
--   * website_requests_public is rebuilt so the public board can show the
--     Wave A package/lifecycle fields — and so drafts are never exposed
--     publicly. The view still never selects `contact` or any other private
--     column; the column order of the original view is preserved and new
--     columns are appended.
--   * Proposal notifications follow the platform's existing pattern
--     (SECURITY DEFINER trigger functions inserting into public.notifications,
--     as notify_seller_new_order() does for orders): the request owner is
--     notified of a new proposal, and a developer is notified when their
--     proposal is accepted or rejected. The notifications table has no
--     client INSERT policy, so triggers are the only supported write path.

-- --------------------------------------------------------------------------
-- Remaining request-form fields
-- --------------------------------------------------------------------------
ALTER TABLE public.website_requests
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS purpose TEXT,
  ADD COLUMN IF NOT EXISTS target_audience TEXT;

-- --------------------------------------------------------------------------
-- Public request board view (drafts excluded, package fields included)
-- --------------------------------------------------------------------------
DROP VIEW IF EXISTS public.website_requests_public;
CREATE VIEW public.website_requests_public AS
SELECT id, requester_id, title, description, budget, currency, status, taken_by, taken_at,
       created_at, updated_at, tier, photos,
       package_type, project_status, category, purpose, target_audience,
       required_pages, required_functionality, preferred_technologies,
       design_references, reference_urls, domain_needs, hosting_needs, deadline,
       is_draft, agreed_amount, agreed_currency, selected_proposal_id
FROM public.website_requests
WHERE NOT is_draft;
GRANT SELECT ON public.website_requests_public TO anon, authenticated;

-- --------------------------------------------------------------------------
-- Proposal notifications (existing trigger pattern)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_requester_new_proposal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_requester UUID;
BEGIN
  SELECT title, requester_id INTO v_title, v_requester
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_requester IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body)
    VALUES (v_requester, 'New proposal received',
            'A developer sent a proposal for "' || COALESCE(v_title, 'your website request') || '".');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_new_proposal ON public.project_proposals;
CREATE TRIGGER trg_notify_new_proposal
  AFTER INSERT ON public.project_proposals
  FOR EACH ROW EXECUTE FUNCTION public.notify_requester_new_proposal();

CREATE OR REPLACE FUNCTION public.notify_developer_proposal_decision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
BEGIN
  IF NEW.status NOT IN ('accepted', 'rejected') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT title INTO v_title FROM public.website_requests WHERE id = NEW.request_id;
  INSERT INTO public.notifications (user_id, title, body)
  VALUES (
    NEW.developer_id,
    CASE WHEN NEW.status = 'accepted' THEN 'Proposal accepted' ELSE 'Proposal rejected' END,
    CASE WHEN NEW.status = 'accepted'
      THEN 'Your proposal for "' || COALESCE(v_title, 'a website request') || '" was accepted. The project is now assigned to you.'
      ELSE 'Your proposal for "' || COALESCE(v_title, 'a website request') || '" was not selected this time.'
    END
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_proposal_decision ON public.project_proposals;
CREATE TRIGGER trg_notify_proposal_decision
  AFTER UPDATE OF status ON public.project_proposals
  FOR EACH ROW EXECUTE FUNCTION public.notify_developer_proposal_decision();

-- ============================================================
-- FILE: supabase/migrations/20261031150000_wave_d_workspace.sql
-- ============================================================
-- VELORA marketplace upgrade — Wave D (additive only).
--
-- Supports the project workspace UI (route /projects/$id):
--   * project_messages — private chat between a website request's two
--     participants (requester + assigned developer). The existing
--     conversations/messages tables are buyer<->seller messaging tied to
--     listings (listing_id FK) and cannot reference a website request, so
--     project chat gets its own table instead of overloading them.
--   * Storage policies for delivery/chat files in the existing private
--     `listing-files` bucket under the `projects/<request_id>/...` prefix.
--     The bucket's long-standing policies are folder-owner based (seller
--     files), which would stop a client from ever opening the assigned
--     developer's delivery files; these policies scope access to the
--     project's participants (and admins) for that prefix only.
--   * Workspace notifications follow the platform's existing pattern
--     (SECURITY DEFINER trigger functions inserting into
--     public.notifications, as in the Wave C proposal triggers): new chat
--     message, preview/final delivery submitted, revision requested, and
--     delivery approved. The notifications table has no client INSERT
--     policy, so triggers remain the only supported write path.

-- --------------------------------------------------------------------------
-- Project messages (workspace chat)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  attachment_paths TEXT[] NOT NULL DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_messages_request_idx
  ON public.project_messages (request_id, created_at);
ALTER TABLE public.project_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.project_messages TO authenticated;
GRANT ALL ON public.project_messages TO service_role;
DROP POLICY IF EXISTS "project message participants read" ON public.project_messages;
CREATE POLICY "project message participants read" ON public.project_messages FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "project participants send messages" ON public.project_messages;
CREATE POLICY "project participants send messages" ON public.project_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
-- Only the recipient marks a message read (the UI updates read_at on rows
-- sent by the other participant); admins may moderate.
DROP POLICY IF EXISTS "project message recipient marks read" ON public.project_messages;
CREATE POLICY "project message recipient marks read" ON public.project_messages FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      sender_id <> auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.website_requests wr
        WHERE wr.id = request_id
          AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (
      sender_id <> auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.website_requests wr
        WHERE wr.id = request_id
          AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
      )
    )
  );

-- --------------------------------------------------------------------------
-- Storage: project files in the private listing-files bucket
-- Path convention: projects/<request_id>/<file> and
--                  projects/<request_id>/chat/<file>
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "project participants upload project files" ON storage.objects;
CREATE POLICY "project participants upload project files" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'listing-files'
    AND (storage.foldername(name))[1] = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id::text = (storage.foldername(name))[2]
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP POLICY IF EXISTS "project participants read project files" ON storage.objects;
CREATE POLICY "project participants read project files" ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'listing-files'
    AND (storage.foldername(name))[1] = 'projects'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.website_requests wr
        WHERE wr.id::text = (storage.foldername(name))[2]
          AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
      )
    )
  );
DROP POLICY IF EXISTS "project participants delete project files" ON storage.objects;
CREATE POLICY "project participants delete project files" ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'listing-files'
    AND (storage.foldername(name))[1] = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id::text = (storage.foldername(name))[2]
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );

-- --------------------------------------------------------------------------
-- Workspace notifications (existing trigger pattern — see Wave C)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_project_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_recipient UUID;
BEGIN
  SELECT title,
         CASE WHEN requester_id = NEW.sender_id THEN taken_by ELSE requester_id END
    INTO v_title, v_recipient
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_recipient IS NOT NULL AND v_recipient <> NEW.sender_id THEN
    INSERT INTO public.notifications (user_id, title, body)
    VALUES (v_recipient, 'New project message',
            'You have a new message in the workspace for "' || COALESCE(v_title, 'your website project') || '".');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_project_message ON public.project_messages;
CREATE TRIGGER trg_notify_project_message
  AFTER INSERT ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_project_message();

CREATE OR REPLACE FUNCTION public.notify_delivery_submitted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_requester UUID;
BEGIN
  SELECT title, requester_id INTO v_title, v_requester
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_requester IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body)
    VALUES (
      v_requester,
      CASE WHEN NEW.kind = 'final' THEN 'Final delivery submitted' ELSE 'Preview submitted' END,
      CASE WHEN NEW.kind = 'final'
        THEN 'The final delivery for "' || COALESCE(v_title, 'your website project') || '" is ready for your review.'
        ELSE 'A new preview (version ' || NEW.version || ') for "' || COALESCE(v_title, 'your website project') || '" is ready for your review.'
      END
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_delivery_submitted ON public.project_deliveries;
CREATE TRIGGER trg_notify_delivery_submitted
  AFTER INSERT ON public.project_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.notify_delivery_submitted();

CREATE OR REPLACE FUNCTION public.notify_revision_requested()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_developer UUID;
BEGIN
  SELECT title, taken_by INTO v_title, v_developer
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_developer IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body)
    VALUES (v_developer, 'Revision requested',
            'The client requested a revision on "' || COALESCE(v_title, 'your website project') || '".');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_revision_requested ON public.project_revisions;
CREATE TRIGGER trg_notify_revision_requested
  AFTER INSERT ON public.project_revisions
  FOR EACH ROW EXECUTE FUNCTION public.notify_revision_requested();

CREATE OR REPLACE FUNCTION public.notify_delivery_approved()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT title INTO v_title FROM public.website_requests WHERE id = NEW.request_id;
  INSERT INTO public.notifications (user_id, title, body)
  VALUES (
    NEW.submitted_by,
    'Delivery approved',
    'Your ' || NEW.kind || ' delivery (version ' || NEW.version || ') for "' ||
      COALESCE(v_title, 'a website project') || '" was approved.'
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_delivery_approved ON public.project_deliveries;
CREATE TRIGGER trg_notify_delivery_approved
  AFTER UPDATE OF status ON public.project_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.notify_delivery_approved();

-- ============================================================
-- FILE: supabase/migrations/20261031160000_wave_f_project_payments.sql
-- ============================================================
-- VELORA marketplace upgrade — Wave F (additive only).
--
-- Project payments for the custom website projects marketplace:
--   * project_payments records one row per Stripe Checkout attempt for a
--     website request whose developer has been selected and whose amount
--     has been agreed (website_requests.agreed_amount / agreed_currency).
--   * The 85/15 split is computed server-side at checkout creation and
--     stored on the row (platform_fee + developer_amount = amount), so the
--     amounts shown to both parties and used for payout records can never
--     drift from what was actually charged.
--   * Rows are written ONLY by trusted server code (checkout creation and
--     the Stripe webhook, both via the service role). Authenticated users
--     get read-only access scoped to the project's two participants
--     (requester + assigned developer) and admins — the same participant
--     pattern the Wave A workspace tables use. There is deliberately no
--     client INSERT/UPDATE/DELETE grant or policy: a payment's status can
--     never be forged from the browser.
--   * Payout execution stays with the existing seller payout system
--     (payout_requests / admin payout queue). This table is the auditable
--     record of what the developer is owed for a project; no payout row is
--     auto-created here because payout_requests balances on /earnings are
--     computed from product orders, and an unlinked project row would
--     corrupt that math.

-- --------------------------------------------------------------------------
-- Project payments
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.website_requests(id) ON DELETE CASCADE,
  payer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_session_id TEXT UNIQUE,
  provider_payment_intent TEXT,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  platform_fee NUMERIC(12,2) NOT NULL,
  developer_amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'disputed', 'partially_refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_payments_request_idx
  ON public.project_payments (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_payments_payment_intent_idx
  ON public.project_payments (provider_payment_intent)
  WHERE provider_payment_intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_payments_payee_idx
  ON public.project_payments (payee_id, created_at DESC);
ALTER TABLE public.project_payments ENABLE ROW LEVEL SECURITY;
-- Read-only for authenticated participants/admins (see policy below);
-- all writes are service-role only.
GRANT SELECT ON public.project_payments TO authenticated;
GRANT ALL ON public.project_payments TO service_role;
DROP POLICY IF EXISTS "project payment participants read" ON public.project_payments;
CREATE POLICY "project payment participants read" ON public.project_payments FOR SELECT
  TO authenticated
  USING (
    auth.uid() = payer_id
    OR auth.uid() = payee_id
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.website_requests wr
      WHERE wr.id = request_id
        AND (wr.requester_id = auth.uid() OR wr.taken_by = auth.uid())
    )
  );
DROP TRIGGER IF EXISTS update_project_payments_updated_at ON public.project_payments;
CREATE TRIGGER update_project_payments_updated_at
  BEFORE UPDATE ON public.project_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

