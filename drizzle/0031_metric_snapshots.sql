-- Dense daily metric history for the workspace-home KPI sparklines (Tier 3 premium
-- refresh). One row per tenant per day, materialized-on-read on dashboard load via an
-- idempotent upsert, so the trend lines get a reliable daily series the sparse report
-- snapshots can't provide. New table -> RLS policy + grant. ASCII only (WIN1252 embedded-pg).

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  captured_on     date NOT NULL,
  open_work       integer NOT NULL DEFAULT 0,
  overdue         integer NOT NULL DEFAULT 0,
  active_programs integer NOT NULL DEFAULT 0,
  programs_total  integer NOT NULL DEFAULT 0,
  tier_percent    integer,
  health_score    integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One snapshot per tenant per day (the upsert target).
CREATE UNIQUE INDEX IF NOT EXISTS metric_snapshots_tenant_day_key
  ON metric_snapshots (tenant_id, captured_on);

GRANT SELECT, INSERT, UPDATE, DELETE ON metric_snapshots TO partneros_app;
ALTER TABLE metric_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metric_snapshots_isolation ON metric_snapshots;
CREATE POLICY metric_snapshots_isolation ON metric_snapshots
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
