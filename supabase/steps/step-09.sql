-- ============================================================
-- NORDEVA setup - STEP 9 of 11
-- Is step ko poora copy karke Supabase SQL Editor me Run karo.
-- ============================================================

-- ===== 20261031130000_wave_b_public_profiles.sql =====
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

-- ===== 20261031140000_wave_c_projects.sql =====
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

-- ===== 20261031150000_wave_d_workspace.sql =====
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

-- ===== 20261031160000_wave_f_project_payments.sql =====
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
