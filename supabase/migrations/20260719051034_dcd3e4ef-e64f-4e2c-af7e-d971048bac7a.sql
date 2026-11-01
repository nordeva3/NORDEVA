
ALTER TABLE public.website_requests
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'normal'
    CHECK (tier IN ('normal','advanced','high_end')),
  ADD COLUMN IF NOT EXISTS photos text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (array_length(photos, 1) IS NULL OR array_length(photos, 1) <= 6);

-- Storage policies for request-photos bucket
CREATE POLICY "Users upload own request photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'request-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users update own request photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'request-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users delete own request photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'request-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Authenticated can read request photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'request-photos');
