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
