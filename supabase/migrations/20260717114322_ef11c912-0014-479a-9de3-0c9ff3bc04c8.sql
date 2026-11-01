CREATE TABLE public.website_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  budget NUMERIC(12,2) NOT NULL CHECK (budget >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','taken','completed','cancelled')),
  taken_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  taken_at TIMESTAMPTZ,
  contact TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_requests TO authenticated;
GRANT SELECT ON public.website_requests TO anon;
GRANT ALL ON public.website_requests TO service_role;

ALTER TABLE public.website_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view requests"
  ON public.website_requests FOR SELECT
  USING (true);

CREATE POLICY "Users can create their own requests"
  ON public.website_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Requester can update own request"
  ON public.website_requests FOR UPDATE
  TO authenticated
  USING (auth.uid() = requester_id)
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Taker can claim or update taken request"
  ON public.website_requests FOR UPDATE
  TO authenticated
  USING (
    (status = 'open' AND taken_by IS NULL)
    OR auth.uid() = taken_by
  )
  WITH CHECK (
    auth.uid() = taken_by
  );

CREATE POLICY "Requester can delete own request"
  ON public.website_requests FOR DELETE
  TO authenticated
  USING (auth.uid() = requester_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_website_requests_updated_at
  BEFORE UPDATE ON public.website_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX website_requests_status_idx ON public.website_requests (status, created_at DESC);