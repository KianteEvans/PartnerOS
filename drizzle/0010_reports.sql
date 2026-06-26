-- ============================================================================
-- Reporting — package partnership performance, risks, funding, readiness, and
-- decisions for leadership and AWS stakeholders.
--
-- A report snapshots metrics aggregated across every section (MDF, ACE,
-- programs, tiers, evidence, tasks, assessments) at generation time into `snapshot`
-- (jsonb), then moves through draft -> reviewed -> approved -> exported with a
-- human approval gate. The stored snapshot makes a report reproducible and
-- auditable. Tenant isolation is RLS, same pattern throughout.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE report_type AS ENUM (
    'executive_plan', 'qbr', 'mdf_performance', 'ace_contribution',
    'program_readiness', 'tier_evidence', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_status AS ENUM ('draft', 'reviewed', 'approved', 'exported');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  title         text NOT NULL,
  report_type   report_type NOT NULL DEFAULT 'executive_plan',
  status        report_status NOT NULL DEFAULT 'draft',
  period_start  date,
  period_end    date,
  snapshot      jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary       text NOT NULL DEFAULT '',
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  approved_at   timestamptz,
  exported_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_tenant_idx ON reports (tenant_id);
CREATE INDEX IF NOT EXISTS reports_tenant_status_idx ON reports (tenant_id, status);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON reports TO partneros_app;

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reports_isolation ON reports;
CREATE POLICY reports_isolation ON reports
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
