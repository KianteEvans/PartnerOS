-- MDF budgets + daily snapshots: an allocation per period (drives budget-vs-
-- committed on the overview) and a daily portfolio series for the hero
-- sparklines/deltas (materialized-on-read on the MDF page load, idempotent per
-- tenant/day). New tables -> RLS policy + grant on each. ASCII only (WIN1252).

CREATE TABLE IF NOT EXISTS mdf_budgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  period_label  text NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  amount        bigint NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mdf_budgets_tenant_idx ON mdf_budgets (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON mdf_budgets TO partneros_app;
ALTER TABLE mdf_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mdf_budgets_isolation ON mdf_budgets;
CREATE POLICY mdf_budgets_isolation ON mdf_budgets
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS mdf_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  captured_on    date NOT NULL,
  approved       bigint NOT NULL DEFAULT 0,
  deployed       bigint NOT NULL DEFAULT 0,
  claimed        bigint NOT NULL DEFAULT 0,
  reimbursed     bigint NOT NULL DEFAULT 0,
  pipeline       bigint NOT NULL DEFAULT 0,
  open_count     integer NOT NULL DEFAULT 0,
  deadline_risks integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One snapshot per tenant per day (the upsert target).
CREATE UNIQUE INDEX IF NOT EXISTS mdf_snapshots_tenant_day_key
  ON mdf_snapshots (tenant_id, captured_on);

GRANT SELECT, INSERT, UPDATE, DELETE ON mdf_snapshots TO partneros_app;
ALTER TABLE mdf_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mdf_snapshots_isolation ON mdf_snapshots;
CREATE POLICY mdf_snapshots_isolation ON mdf_snapshots
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
