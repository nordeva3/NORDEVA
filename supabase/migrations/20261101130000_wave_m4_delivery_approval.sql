-- VELORA ecosystem upgrade — Wave M4 (additive only, data-preserving).
--
-- project_deliveries: record WHEN the buyer approved a delivery.
-- Approval was previously only inferable from the delivery's
-- status = 'approved' plus the parent request's updated_at; approved_at
-- stamps the exact moment the buyer accepted a preview or the final
-- delivery in the workspace (set by the workspace approve action).
-- Guarded so the file can run once over a partially migrated database.

ALTER TABLE public.project_deliveries
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
