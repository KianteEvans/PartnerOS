-- AWS Marketplace -- Partner Revenue Measurement (PRM). attribution_config is partner-
-- managed (the three attribution methods set up per listing: Marketplace Metering,
-- Resource Tagging, User Agent String). attributions is a mirror of the Attributed Revenue
-- / Reporting API: attributed AWS-consumption revenue by listing x AWS service x billing
-- period. revenue_snapshots is a daily trend row (capture-on-read). Money in integer cents
-- (bigint for aggregate snapshot totals). ASCII.

DO $$ BEGIN
  CREATE TYPE marketplace_attribution_method AS ENUM (
    'marketplace_metering', 'resource_tagging', 'user_agent'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketplace_attribution_status AS ENUM ('configured', 'active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS marketplace_attribution_config (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  listing_id  uuid NOT NULL REFERENCES marketplace_listings (id) ON DELETE CASCADE,
  method      marketplace_attribution_method NOT NULL,
  enabled     boolean NOT NULL DEFAULT false,
  status      marketplace_attribution_status NOT NULL DEFAULT 'inactive',
  notes       text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_attribution_config_unique
  ON marketplace_attribution_config (tenant_id, listing_id, method);
CREATE INDEX IF NOT EXISTS marketplace_attribution_config_listing_idx
  ON marketplace_attribution_config (tenant_id, listing_id);

CREATE TABLE IF NOT EXISTS marketplace_attributions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  attribution_ref text NOT NULL,
  listing_id      uuid REFERENCES marketplace_listings (id) ON DELETE SET NULL,
  aws_service     text NOT NULL DEFAULT '',
  billing_period  text NOT NULL DEFAULT '',
  -- Attributed revenue in integer cents. USD.
  amount          integer NOT NULL DEFAULT 0,
  method          marketplace_attribution_method NOT NULL DEFAULT 'marketplace_metering',
  last_synced_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_attributions_unique
  ON marketplace_attributions (tenant_id, attribution_ref);
CREATE INDEX IF NOT EXISTS marketplace_attributions_listing_idx
  ON marketplace_attributions (tenant_id, listing_id);

CREATE TABLE IF NOT EXISTS marketplace_revenue_snapshots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  captured_on             date NOT NULL,
  listings                integer NOT NULL DEFAULT 0,
  published               integer NOT NULL DEFAULT 0,
  active_entitlements     integer NOT NULL DEFAULT 0,
  metered_usage_cents     bigint NOT NULL DEFAULT 0,
  attributed_revenue_cents bigint NOT NULL DEFAULT 0,
  mrr_cents               bigint NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_revenue_snapshots_unique
  ON marketplace_revenue_snapshots (tenant_id, captured_on);

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_attribution_config TO partneros_app;
ALTER TABLE marketplace_attribution_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_attribution_config_isolation ON marketplace_attribution_config;
CREATE POLICY marketplace_attribution_config_isolation ON marketplace_attribution_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_attributions TO partneros_app;
ALTER TABLE marketplace_attributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_attributions_isolation ON marketplace_attributions;
CREATE POLICY marketplace_attributions_isolation ON marketplace_attributions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_revenue_snapshots TO partneros_app;
ALTER TABLE marketplace_revenue_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_revenue_snapshots_isolation ON marketplace_revenue_snapshots;
CREATE POLICY marketplace_revenue_snapshots_isolation ON marketplace_revenue_snapshots
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Marketplace connector columns on the shared per-tenant AWS connection. Partner Central
-- and Marketplace toggle independently against the same cross-account role.
ALTER TABLE aws_connection
  ADD COLUMN IF NOT EXISTS marketplace_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE aws_connection
  ADD COLUMN IF NOT EXISTS seller_id text NOT NULL DEFAULT '';
ALTER TABLE aws_connection
  ADD COLUMN IF NOT EXISTS marketplace_status text NOT NULL DEFAULT 'not_configured';
ALTER TABLE aws_connection
  ADD COLUMN IF NOT EXISTS marketplace_last_synced_at timestamptz;
ALTER TABLE aws_connection
  ADD COLUMN IF NOT EXISTS marketplace_last_error text;
