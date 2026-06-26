-- ============================================================================
-- Per-tenant SSO / SCIM configuration. One row per tenant. SCIM provisioning is
-- authenticated by a bearer token whose SHA-256 hash is stored here (never the
-- plaintext); the /api/scim routes resolve the tenant by hashing the presented
-- token and matching it (privileged, no session — the IdP isn't a logged-in
-- user). The admin-facing reads/writes from Settings are RLS tenant-scoped.
--
-- SAML columns will extend this same table when SSO login is built; for now it
-- carries the SCIM fields only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sso_config (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  scim_enabled     boolean NOT NULL DEFAULT false,
  scim_token_hash  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Token-hash lookup is global (the bearer token alone identifies the tenant), so
-- it must be unique across tenants. Partial: only populated hashes participate.
CREATE UNIQUE INDEX IF NOT EXISTS sso_config_scim_token_idx
  ON sso_config (scim_token_hash) WHERE scim_token_hash IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON sso_config TO partneros_app;

ALTER TABLE sso_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sso_config_isolation ON sso_config;
CREATE POLICY sso_config_isolation ON sso_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
