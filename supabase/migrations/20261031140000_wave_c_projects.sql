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
