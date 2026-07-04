-- ============================================================================
-- Cross-tenant benchmarking ("partners like you"). A system-level job aggregates
-- each OPTED-IN tenant's latest metric_snapshot into anonymized cohort percentiles
-- (by partner tier and by tenure), which opted-in tenants read to see where they
-- fall. ACE is single-account and can never show peer comparison; this is a pure
-- network-effect moat. Privacy: opt-in + reciprocal; k-anonymity (>= 5) enforced
-- in the aggregation code; benchmark_cohorts stores NO tenant identity.
-- ============================================================================

-- Reciprocal opt-in: a workspace contributes + sees benchmarks only when true.
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS benchmark_participation boolean NOT NULL DEFAULT false;

-- Three more benchmarkable metrics captured into the daily per-tenant snapshot.
-- win_rate / mdf_roi are nullable (null = "not enough data to compute").
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS win_rate_percent integer;
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS evidence_percent integer NOT NULL DEFAULT 0;
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS mdf_roi_x100 integer;

-- Anonymized cohort aggregates. NO tenant_id: one row per (dimension, cohort, metric, day)
-- holding percentiles + the sample size. Written only by the system aggregation job.
CREATE TABLE IF NOT EXISTS benchmark_cohorts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_dimension  text NOT NULL,       -- 'tier' | 'tenure'
  cohort_value      text NOT NULL,       -- e.g. 'advanced' | '12_24mo'
  metric            text NOT NULL,       -- one of the BENCHMARK_METRICS keys
  captured_on       date NOT NULL,
  p25               bigint NOT NULL DEFAULT 0,
  p50               bigint NOT NULL DEFAULT 0,
  p75               bigint NOT NULL DEFAULT 0,
  p90               bigint NOT NULL DEFAULT 0,
  sample_count      integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS benchmark_cohorts_key
  ON benchmark_cohorts (cohort_dimension, cohort_value, metric, captured_on);

-- ----------------------------------------------------------------------------
-- Privileges + RLS. The aggregates are non-identifying, so any authenticated
-- tenant may READ them; only the system job (table owner, via withSystem) writes.
-- ----------------------------------------------------------------------------
GRANT SELECT ON benchmark_cohorts TO partneros_app;

ALTER TABLE benchmark_cohorts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS benchmark_cohorts_read ON benchmark_cohorts;
CREATE POLICY benchmark_cohorts_read ON benchmark_cohorts
  FOR SELECT USING (true);
