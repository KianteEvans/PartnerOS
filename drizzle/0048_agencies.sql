-- ============================================================================
-- Agency / portfolio mode (Bet C, the OPS+NET moat). An "agency" is a tenant
-- flagged is_agency that manages a book of partner workspaces (tenants whose
-- agency_id points back at the agency). Agency operators see a cross-workspace
-- portfolio and can "act as" any managed workspace. This is deliberately NOT an
-- RLS redesign: management is authorization + per-tenant orchestration layered on
-- top of the existing single-tenant RLS (every query still binds one app.tenant_id).
-- Cross-tenant reads/writes go through withSystem with explicit authorization,
-- exactly like the existing provisioning + cron code.
-- ============================================================================

-- An agency (parent) is a tenant with is_agency=true. A managed workspace points
-- at its agency via agency_id (self-referential FK). Nested agencies are excluded
-- in application code (is_agency XOR agency_id).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_agency boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS tenants_agency_idx ON tenants (agency_id);

-- Claim/link consent handshake: an agency requests to manage an EXISTING workspace,
-- and the TARGET owner approves. Scoped by target_tenant_id so the approver can read
-- + decide via ordinary RLS from their own session; the agency's OUTGOING list is
-- read via withSystem (its session tenant is the agency, not the target).
CREATE TABLE IF NOT EXISTS agency_link_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'pending',
  requested_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  decided_by        uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS agency_link_requests_target_idx ON agency_link_requests (target_tenant_id);
CREATE INDEX IF NOT EXISTS agency_link_requests_agency_idx ON agency_link_requests (agency_tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON agency_link_requests TO partneros_app;

ALTER TABLE agency_link_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_link_requests_target ON agency_link_requests;
CREATE POLICY agency_link_requests_target ON agency_link_requests
  USING (target_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (target_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
