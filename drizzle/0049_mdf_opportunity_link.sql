-- ============================================================================
-- Full ROI loops (Wave 2). To attribute realized (won) revenue back to the MDF
-- that influenced it, the MDF->opportunity link must be trustworthy. Today it is a
-- free-text `opportunity_ref` (best-effort matched on opp id/external_id/name);
-- Funding already has a real FK. This adds the same FK to MDF and backfills it from
-- the existing free-text refs. `opportunity_ref` is kept for display/back-compat.
-- ============================================================================

ALTER TABLE mdf_requests
  ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS mdf_requests_opportunity_idx ON mdf_requests (opportunity_id);

-- Best-effort promote of existing free-text refs to the real FK. Tenant-scoped so a
-- ref never matches another tenant's opportunity. Matches id / external_id / name,
-- exactly like the deal-desk loader's runtime fallback.
UPDATE mdf_requests m
   SET opportunity_id = o.id
  FROM opportunities o
 WHERE m.opportunity_id IS NULL
   AND o.tenant_id = m.tenant_id
   AND m.opportunity_ref IS NOT NULL
   AND m.opportunity_ref IN (o.id::text, o.external_id, o.name);
