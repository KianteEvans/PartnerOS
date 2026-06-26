-- ============================================================================
-- Settings & Integrations — configure the workspace, automation governance, and
-- data connectors.
--
-- workspace_settings: one row per tenant (display name, automation mode,
-- notifications). connectors: one row per (tenant, kind) modelling the
-- integration registry (ACE, Salesforce, Marketplace, AWS Context, imports).
-- Users & roles are managed on the existing users table (user:update).
-- Tenant isolation is RLS, same pattern throughout.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE automation_mode AS ENUM (
    'off', 'recommend_only', 'auto_with_approval', 'autonomous'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE connector_kind AS ENUM (
    'ace', 'salesforce', 'marketplace', 'aws_context', 'mdf_import', 'csv', 'notetaker'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE connector_status AS ENUM (
    'not_configured', 'configured', 'disabled', 'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS workspace_settings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  display_name         text NOT NULL DEFAULT '',
  automation_mode      automation_mode NOT NULL DEFAULT 'recommend_only',
  email_notifications  boolean NOT NULL DEFAULT true,
  created_by           uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_settings_tenant_unique
  ON workspace_settings (tenant_id);

CREATE TABLE IF NOT EXISTS connectors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  kind          connector_kind NOT NULL,
  status        connector_status NOT NULL DEFAULT 'not_configured',
  auth_mode     text NOT NULL DEFAULT '',
  endpoint      text NOT NULL DEFAULT '',
  last_sync_at  timestamptz,
  notes         text NOT NULL DEFAULT '',
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS connectors_tenant_kind_unique
  ON connectors (tenant_id, kind);
CREATE INDEX IF NOT EXISTS connectors_tenant_idx ON connectors (tenant_id);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_settings, connectors TO partneros_app;

ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_settings_isolation ON workspace_settings;
CREATE POLICY workspace_settings_isolation ON workspace_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connectors_isolation ON connectors;
CREATE POLICY connectors_isolation ON connectors
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
