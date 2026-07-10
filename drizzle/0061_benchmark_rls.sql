-- ============================================================================
-- Tighten benchmark_cohorts reads (MVP readiness P0). The 0047 policy allowed
-- any authenticated tenant to SELECT cohorts (USING (true)), which left the two
-- stated privacy promises -- reciprocal opt-in and k-anonymity (>= 5) --
-- enforced only in application code. Enforce both at the database layer:
--
--   1. only tenants whose workspace_settings.benchmark_participation is true
--      may read cohorts (reciprocal opt-in), and
--   2. rows below the k-anonymity floor are invisible even if a partial or
--      buggy aggregation run ever persisted one.
--
-- The system aggregation job writes as the table owner via withSystem and is
-- unaffected (owner is not subject to RLS on this table).
-- ============================================================================

DROP POLICY IF EXISTS benchmark_cohorts_read ON benchmark_cohorts;
CREATE POLICY benchmark_cohorts_read ON benchmark_cohorts
  FOR SELECT USING (
    sample_count >= 5
    AND EXISTS (
      SELECT 1
      FROM workspace_settings ws
      WHERE ws.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        AND ws.benchmark_participation = true
    )
  );
