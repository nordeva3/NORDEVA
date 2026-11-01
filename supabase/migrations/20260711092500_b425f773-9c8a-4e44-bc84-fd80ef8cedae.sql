
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS file_path text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_size bigint;

-- Seller can insert/update/delete their own objects (folder = their user id)
CREATE POLICY "listing-files seller insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'listing-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "listing-files seller update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'listing-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "listing-files seller delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'listing-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "listing-files seller read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'listing-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
