-- MDF marketing event planner. A saved "marketing plan" (mdf_event_plans) holds
-- candidate events (mdf_plan_items) a partner assembles against their available
-- MDF before converting eligible items into real requests. Also grounds requests
-- in the AWS activity catalog (catalog_key / total_cost / aws_branding_confirmed).
-- New tables -> RLS policy + grant on each. ASCII only (WIN1252 embedded-pg).

CREATE TABLE IF NOT EXISTS mdf_event_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'draft',
  notes       text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mdf_event_plans_tenant_idx ON mdf_event_plans (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON mdf_event_plans TO partneros_app;
ALTER TABLE mdf_event_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mdf_event_plans_isolation ON mdf_event_plans;
CREATE POLICY mdf_event_plans_isolation ON mdf_event_plans
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS mdf_plan_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  plan_id                uuid NOT NULL REFERENCES mdf_event_plans (id) ON DELETE CASCADE,
  title                  text NOT NULL,
  catalog_key            text,
  activity_type          mdf_activity_type NOT NULL DEFAULT 'other',
  total_cost             integer NOT NULL DEFAULT 0,
  co_fund_pct            integer NOT NULL DEFAULT 50,
  expected_pipeline      integer NOT NULL DEFAULT 0,
  expected_opportunities integer NOT NULL DEFAULT 0,
  start_date             date,
  end_date               date,
  spms_id                text,
  request_id             uuid REFERENCES mdf_requests (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mdf_plan_items_tenant_plan_idx ON mdf_plan_items (tenant_id, plan_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON mdf_plan_items TO partneros_app;
ALTER TABLE mdf_plan_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mdf_plan_items_isolation ON mdf_plan_items;
CREATE POLICY mdf_plan_items_isolation ON mdf_plan_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Ground existing requests in the AWS activity catalog + carry the full activity cost.
ALTER TABLE mdf_requests ADD COLUMN IF NOT EXISTS catalog_key text;
ALTER TABLE mdf_requests ADD COLUMN IF NOT EXISTS total_cost integer;
ALTER TABLE mdf_requests ADD COLUMN IF NOT EXISTS aws_branding_confirmed boolean NOT NULL DEFAULT false;
