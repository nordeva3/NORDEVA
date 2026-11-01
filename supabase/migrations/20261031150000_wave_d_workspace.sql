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
