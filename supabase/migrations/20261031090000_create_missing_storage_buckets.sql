-- VELORA completion fix: the original migrations create storage POLICIES for
-- the `listing-files` and `request-photos` buckets but never create the
-- buckets themselves (only `listing-media` was created, in
-- 20260926160000_production_completion.sql). Without this migration the
-- seller upload flow fails on a fresh project with "Bucket not found".
--
-- listing-files: private delivery files (buyers get signed URLs only).
-- request-photos: private photos attached to website requests.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('listing-files', 'listing-files', false, 104857600)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('request-photos', 'request-photos', false, 26214400)
ON CONFLICT (id) DO NOTHING;
