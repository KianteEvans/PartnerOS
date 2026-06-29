-- Co-Selling Goals for the ACE section: organizations set targets for their AWS
-- co-sell relationship (Total Revenue, Net New AWS Rep Relationships, Net New
-- AWS-Originated Opportunities, etc.) and the platform tracks current-vs-target.
-- ace_goal_snapshots gives each goal a daily progress series for the trend line,
-- materialized-on-read on the ACE page load (idempotent per tenant/goal/day).
-- New tables -> RLS policy + grant on each. ASCII only (WIN1252 embedded-pg).

CREATE TABLE IF NOT EXISTS ace_goals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  metric_key      text NOT NULL,
  target_value    bigint NOT NULL,
  period_start    date NOT NULL,
  target_deadline date,
  status          text NOT NULL DEFAULT 'active',
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ace_goals_tenant_idx ON ace_goals (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON ace_goals TO partneros_app;
ALTER TABLE ace_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ace_goals_isolation ON ace_goals;
CREATE POLICY ace_goals_isolation ON ace_goals
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS ace_goal_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  goal_id       uuid NOT NULL REFERENCES ace_goals (id) ON DELETE CASCADE,
  captured_on   date NOT NULL,
  current_value bigint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One snapshot per tenant per goal per day (the upsert target).
CREATE UNIQUE INDEX IF NOT EXISTS ace_goal_snapshots_goal_day_key
  ON ace_goal_snapshots (tenant_id, goal_id, captured_on);

GRANT SELECT, INSERT, UPDATE, DELETE ON ace_goal_snapshots TO partneros_app;
ALTER TABLE ace_goal_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ace_goal_snapshots_isolation ON ace_goal_snapshots;
CREATE POLICY ace_goal_snapshots_isolation ON ace_goal_snapshots
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
