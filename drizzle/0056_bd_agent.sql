-- ============================================================================
-- Business Development agent (Phase 1) -- OBP's own outbound sales loop. Unifies
-- prospects from four sources into one pipeline, has the AI agent DRAFT outreach,
-- and gates first-touch sends behind human approval before they go out over the
-- existing EMAIL_DELIVERY_URL relay.
--
--   bd_prospects   one row per prospect, from any of four sources (inbound demo
--                  lead / cold outbound / AWS contact / partner referral)
--   bd_messages    the draft -> approval -> send ledger; one row per outreach
--                  message, agent- or user-drafted
--
-- source/stage/kind/status are TEXT (not enums) so new sources/stages/kinds never
-- need a migration, mirroring tasks.source and playbooks.action_type. Tenant
-- isolation is RLS throughout.
--
-- demo_requests is the tenant-free public inbound table; it gains claim columns so
-- a demo lead is imported by exactly one tenant (compare-and-set on import) and can
-- never be double-claimed across tenants.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- bd_prospects -- the unified BD pipeline
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bd_prospects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  source         text NOT NULL,
  source_ref     text,
  name           text NOT NULL,
  email          text NOT NULL DEFAULT '',
  company        text NOT NULL DEFAULT '',
  title          text NOT NULL DEFAULT '',
  stage          text NOT NULL DEFAULT 'new',
  owner_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  notes          text NOT NULL DEFAULT '',
  next_action_at timestamptz,
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bd_prospects_tenant_idx ON bd_prospects (tenant_id);
CREATE INDEX IF NOT EXISTS bd_prospects_tenant_stage_idx ON bd_prospects (tenant_id, stage);
-- A given external record is imported at most once per tenant (fire-once import).
CREATE UNIQUE INDEX IF NOT EXISTS bd_prospects_source_ref_unique
  ON bd_prospects (tenant_id, source, source_ref)
  WHERE source_ref IS NOT NULL;

-- ----------------------------------------------------------------------------
-- bd_messages -- the draft -> approval -> send ledger
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bd_messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  prospect_id          uuid NOT NULL REFERENCES bd_prospects (id) ON DELETE CASCADE,
  kind                 text NOT NULL DEFAULT 'first_touch',
  channel              text NOT NULL DEFAULT 'email',
  subject              text NOT NULL DEFAULT '',
  body                 text NOT NULL DEFAULT '',
  status               text NOT NULL DEFAULT 'draft',
  drafted_by           text NOT NULL DEFAULT 'agent',
  approved_by_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  email_status         text NOT NULL DEFAULT 'none',
  sent_at              timestamptz,
  created_by           uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bd_messages_tenant_idx ON bd_messages (tenant_id);
CREATE INDEX IF NOT EXISTS bd_messages_tenant_status_idx ON bd_messages (tenant_id, status);
CREATE INDEX IF NOT EXISTS bd_messages_prospect_idx ON bd_messages (prospect_id);

-- ----------------------------------------------------------------------------
-- demo_requests -- claim columns so a lead is owned by exactly one tenant
-- ----------------------------------------------------------------------------
ALTER TABLE demo_requests ADD COLUMN IF NOT EXISTS imported_by_tenant uuid REFERENCES tenants (id) ON DELETE SET NULL;
ALTER TABLE demo_requests ADD COLUMN IF NOT EXISTS imported_at timestamptz;
CREATE INDEX IF NOT EXISTS demo_requests_unclaimed_idx
  ON demo_requests (status)
  WHERE imported_by_tenant IS NULL;

-- ----------------------------------------------------------------------------
-- Privileges + RLS (same pattern throughout the app)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON bd_prospects TO partneros_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bd_messages TO partneros_app;

ALTER TABLE bd_prospects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bd_prospects_isolation ON bd_prospects;
CREATE POLICY bd_prospects_isolation ON bd_prospects
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE bd_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bd_messages_isolation ON bd_messages;
CREATE POLICY bd_messages_isolation ON bd_messages
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
