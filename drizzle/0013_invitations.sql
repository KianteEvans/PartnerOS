-- ============================================================================
-- Workspace invitations. An owner/admin invites a teammate by email + role,
-- creating a PENDING invitation. At the invitee's first OIDC login, a pending
-- invite matching their email is consumed (in src/auth/provision.ts, under
-- withSystem since no session exists yet): their user is created in the inviting
-- tenant with the invited role, and the invite is marked accepted. This is the
-- multi-user onboarding path — without an invite, a new identity is rejected in
-- production (and only auto-provisions a personal tenant under local dev).
--
-- Tenant isolation for the admin-facing reads/writes is RLS, same as elsewhere;
-- the cross-tenant email lookup at consumption runs privileged (withSystem).
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS invitations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  email                text NOT NULL,
  role                 user_role NOT NULL DEFAULT 'member',
  status               invitation_status NOT NULL DEFAULT 'pending',
  token                text NOT NULL,
  invited_by_user_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  accepted_by_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  accepted_at          timestamptz
);

-- At most one PENDING invite per (tenant, email); accepted/revoked rows persist
-- as history.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_unique
  ON invitations (tenant_id, lower(email)) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_unique ON invitations (token);
CREATE INDEX IF NOT EXISTS invitations_tenant_idx ON invitations (tenant_id);
-- Consumption looks up pending invites by email (across tenants, under withSystem).
CREATE INDEX IF NOT EXISTS invitations_email_pending_idx
  ON invitations (lower(email)) WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON invitations TO partneros_app;

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invitations_isolation ON invitations;
CREATE POLICY invitations_isolation ON invitations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
