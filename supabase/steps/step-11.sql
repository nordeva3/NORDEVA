-- ============================================================
-- NORDEVA setup - STEP 11 of 11
-- Is step ko poora copy karke Supabase SQL Editor me Run karo.
-- ============================================================

-- ===== 20261101140000_wave_m6_notification_links.sql =====
-- VELORA ecosystem upgrade — Wave M6 (additive only, data-preserving).
--
-- Notification deep links for the project workflow:
--   * The six project notification trigger functions from Waves C/D are
--     redefined verbatim, with only the notifications INSERT extended to
--     carry href = '/projects/' || request_id (the column was added in
--     Wave M1, and the DM trigger there already fills it). The existing
--     triggers keep calling these functions by name, so no trigger
--     changes are needed for them.
--   * A NEW trigger on project_disputes (table added in Wave M1) notifies
--     the project participant who did not raise the dispute, plus every
--     admin (pointed at /admin) so disputes get reviewed.
--
-- Guarded (CREATE OR REPLACE / DROP TRIGGER IF EXISTS) so the file can
-- run once over a partially migrated database.

-- --------------------------------------------------------------------------
-- Proposal notifications (Wave C functions, href added)
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
    INSERT INTO public.notifications (user_id, title, body, href)
    VALUES (v_requester, 'New proposal received',
            'A developer sent a proposal for "' || COALESCE(v_title, 'your website request') || '".',
            '/projects/' || NEW.request_id::text);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_developer_proposal_decision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
BEGIN
  IF NEW.status NOT IN ('accepted', 'rejected') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT title INTO v_title FROM public.website_requests WHERE id = NEW.request_id;
  INSERT INTO public.notifications (user_id, title, body, href)
  VALUES (
    NEW.developer_id,
    CASE WHEN NEW.status = 'accepted' THEN 'Proposal accepted' ELSE 'Proposal rejected' END,
    CASE WHEN NEW.status = 'accepted'
      THEN 'Your proposal for "' || COALESCE(v_title, 'a website request') || '" was accepted. The project is now assigned to you.'
      ELSE 'Your proposal for "' || COALESCE(v_title, 'a website request') || '" was not selected this time.'
    END,
    '/projects/' || NEW.request_id::text
  );
  RETURN NEW;
END;
$$;

-- --------------------------------------------------------------------------
-- Workspace notifications (Wave D functions, href added)
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
    INSERT INTO public.notifications (user_id, title, body, href)
    VALUES (v_recipient, 'New project message',
            'You have a new message in the workspace for "' || COALESCE(v_title, 'your website project') || '".',
            '/projects/' || NEW.request_id::text);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_delivery_submitted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_requester UUID;
BEGIN
  SELECT title, requester_id INTO v_title, v_requester
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_requester IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, href)
    VALUES (
      v_requester,
      CASE WHEN NEW.kind = 'final' THEN 'Final delivery submitted' ELSE 'Preview submitted' END,
      CASE WHEN NEW.kind = 'final'
        THEN 'The final delivery for "' || COALESCE(v_title, 'your website project') || '" is ready for your review.'
        ELSE 'A new preview (version ' || NEW.version || ') for "' || COALESCE(v_title, 'your website project') || '" is ready for your review.'
      END,
      '/projects/' || NEW.request_id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_revision_requested()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_developer UUID;
BEGIN
  SELECT title, taken_by INTO v_title, v_developer
  FROM public.website_requests WHERE id = NEW.request_id;
  IF v_developer IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, href)
    VALUES (v_developer, 'Revision requested',
            'The client requested a revision on "' || COALESCE(v_title, 'your website project') || '".',
            '/projects/' || NEW.request_id::text);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_delivery_approved()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT title INTO v_title FROM public.website_requests WHERE id = NEW.request_id;
  INSERT INTO public.notifications (user_id, title, body, href)
  VALUES (
    NEW.submitted_by,
    'Delivery approved',
    'Your ' || NEW.kind || ' delivery (version ' || NEW.version || ') for "' ||
      COALESCE(v_title, 'a website project') || '" was approved.',
    '/projects/' || NEW.request_id::text
  );
  RETURN NEW;
END;
$$;

-- --------------------------------------------------------------------------
-- Dispute notifications (NEW — project_disputes arrived in Wave M1 with
-- no notification trigger). The participant who did not raise the dispute
-- is pointed at the workspace; every admin is pointed at /admin. An admin
-- who is already the notified participant is not double-notified, and the
-- person who raised the dispute is never notified about their own action.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_project_dispute()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  v_requester UUID;
  v_developer UUID;
  v_other UUID;
BEGIN
  SELECT title, requester_id, taken_by INTO v_title, v_requester, v_developer
  FROM public.website_requests WHERE id = NEW.project_id;

  v_other := CASE WHEN NEW.raised_by = v_requester THEN v_developer ELSE v_requester END;
  IF v_other IS NOT NULL AND v_other <> NEW.raised_by THEN
    INSERT INTO public.notifications (user_id, title, body, href)
    VALUES (v_other, 'Dispute raised',
            'A dispute was raised on "' || COALESCE(v_title, 'your website project') || '".',
            '/projects/' || NEW.project_id::text);
  END IF;

  INSERT INTO public.notifications (user_id, title, body, href)
  SELECT ur.user_id, 'New project dispute',
         'New project dispute needs review: "' || COALESCE(v_title, 'a website project') || '".',
         '/admin'
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND ur.user_id <> NEW.raised_by
    AND ur.user_id IS DISTINCT FROM v_other;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_project_dispute ON public.project_disputes;
CREATE TRIGGER trg_notify_project_dispute
  AFTER INSERT ON public.project_disputes
  FOR EACH ROW EXECUTE FUNCTION public.notify_project_dispute();
