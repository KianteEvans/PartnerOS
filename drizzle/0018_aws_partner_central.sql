-- ============================================================================
-- AWS Partner Central connector + co-sell opportunity mirror.
--
-- aws_connection: one row per tenant holding the cross-account IAM role the app
-- assumes (sts:AssumeRole with the external id) to call Partner Central. The role
-- ARN + external id are low-value on their own (the external id only has meaning
-- paired with the role's trust policy on the tenant's AWS side); RLS scopes reads
-- to the owning tenant, exactly like sso_config. No long-lived AWS secret stored.
--
-- partner_central_opportunities: a READ-ONLY mirror of co-sell opportunities
-- pulled from Partner Central (Sandbox catalog by default). Native ACE
-- `opportunities` remain the editable system of record; these rows are display-
-- only and refreshed by the sync. Reuses the opportunity_stage/status enums.
-- ============================================================================

CREATE TABLE IF NOT EXISTS aws_connection (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  role_arn        text NOT NULL DEFAULT '',
  external_id     text NOT NULL DEFAULT '',
  region          text NOT NULL DEFAULT 'us-east-1',
  catalog         text NOT NULL DEFAULT 'Sandbox',
  enabled         boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'not_configured',
  last_synced_at  timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_central_opportunities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  external_id   text NOT NULL,
  name          text NOT NULL DEFAULT '',
  account_name  text NOT NULL DEFAULT '',
  stage         opportunity_stage NOT NULL DEFAULT 'prospect',
  status        opportunity_status NOT NULL DEFAULT 'open',
  amount        integer NOT NULL DEFAULT 0 CHECK (amount >= 0),
  aws_stage_raw text NOT NULL DEFAULT '',
  synced_at     timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- One mirror row per (tenant, AWS opportunity id) — re-sync upserts, never dupes.
CREATE UNIQUE INDEX IF NOT EXISTS pc_opps_tenant_external_idx
  ON partner_central_opportunities (tenant_id, external_id);
CREATE INDEX IF NOT EXISTS pc_opps_tenant_idx ON partner_central_opportunities (tenant_id);
CREATE INDEX IF NOT EXISTS pc_opps_tenant_status_idx ON partner_central_opportunities (tenant_id, status);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON aws_connection, partner_central_opportunities TO partneros_app;

ALTER TABLE aws_connection ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aws_connection_isolation ON aws_connection;
CREATE POLICY aws_connection_isolation ON aws_connection
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE partner_central_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pc_opps_isolation ON partner_central_opportunities;
CREATE POLICY pc_opps_isolation ON partner_central_opportunities
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
