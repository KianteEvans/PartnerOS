-- ============================================================================
-- PartnerOS initial migration.
--
-- Tenant isolation is enforced HERE, by PostgreSQL Row-Level Security (Rule 2),
-- not by application code. The non-privileged role `partneros_app` (assumed via
-- SET LOCAL ROLE for every request) is subject to the policies below. A query
-- that forgets to scope returns ZERO rows from other tenants, because the
-- policies compare against the transaction-local `app.tenant_id` GUC, which is
-- NULL when unset -> the predicate is NULL -> the row is filtered out.
-- ============================================================================

-- Required for gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- Application role: no LOGIN, no BYPASSRLS. Owns nothing. Everything the request
-- path touches runs as this role, so RLS is always evaluated.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'partneros_app') THEN
    CREATE ROLE partneros_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

-- Allow the migrating/connecting role to assume partneros_app (SET ROLE).
-- Superusers already can; this matters for a least-privilege production owner.
DO $$
BEGIN
  EXECUTE format('GRANT partneros_app TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  -- already a member / insufficient privilege under superuser: ignore.
  NULL;
END
$$;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE partner_tier AS ENUM ('registered', 'select', 'advanced', 'premier');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('owner', 'admin', 'manager', 'member', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scan_status AS ENUM ('pending', 'clean', 'infected', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL,
  tier        partner_tier NOT NULL DEFAULT 'registered',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_key ON tenants (slug);

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  oidc_subject  text NOT NULL,
  email         text NOT NULL,
  role          user_role NOT NULL DEFAULT 'member',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_subject_key ON users (tenant_id, oidc_subject);
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email_key   ON users (tenant_id, email);
CREATE INDEX IF NOT EXISTS users_tenant_idx ON users (tenant_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  key              text NOT NULL,
  request_hash     text NOT NULL,
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_tenant_key ON idempotency_keys (tenant_id, key);
CREATE INDEX IF NOT EXISTS idempotency_tenant_idx ON idempotency_keys (tenant_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  actor_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  action         text NOT NULL,
  resource_type  text NOT NULL,
  resource_id    text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_tenant_idx ON audit_log (tenant_id);
CREATE INDEX IF NOT EXISTS audit_tenant_created_idx ON audit_log (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS storage_objects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  bucket        text NOT NULL,
  object_key    text NOT NULL,
  content_type  text NOT NULL,
  size_bytes    bigint NOT NULL,
  scan_status   scan_status NOT NULL DEFAULT 'pending',
  scanned_at    timestamptz,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS storage_tenant_key ON storage_objects (tenant_id, bucket, object_key);
CREATE INDEX IF NOT EXISTS storage_tenant_idx ON storage_objects (tenant_id);

-- ----------------------------------------------------------------------------
-- Privileges: partneros_app gets DML only. No DDL, no ownership.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO partneros_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, users, idempotency_keys, audit_log, storage_objects
  TO partneros_app;

-- ----------------------------------------------------------------------------
-- Row-Level Security. Helper expression: current tenant from the GUC, NULL-safe.
--   NULLIF(current_setting('app.tenant_id', true), '')::uuid
-- current_setting(..., true) returns the GUC text, or NULL if never set. BUT a
-- custom GUC that was set transaction-locally (SET LOCAL / set_config(...,true))
-- reverts to an EMPTY STRING — not NULL — after the transaction. On a pooled
-- connection that empty string would hit `''::uuid` and raise an error instead
-- of filtering. NULLIF(...,'') maps both unset and reverted-empty to NULL, so
-- the predicate is NULL and nothing is visible: the fail-closed default (Rule 2).
-- ----------------------------------------------------------------------------

-- tenants: a session sees ONLY its own tenant row.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenants_isolation ON tenants;
CREATE POLICY tenants_isolation ON tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_isolation ON users;
CREATE POLICY users_isolation ON users
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- idempotency_keys
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS idempotency_isolation ON idempotency_keys;
CREATE POLICY idempotency_isolation ON idempotency_keys
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- audit_log: append + read within tenant. No UPDATE/DELETE policy => immutable
-- to the app role (append-only audit trail). The grant above still allows the
-- statements, but without a permissive policy for UPDATE/DELETE they affect 0
-- rows; we additionally withhold those rights below for clarity.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_select ON audit_log;
CREATE POLICY audit_select ON audit_log
  FOR SELECT
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
DROP POLICY IF EXISTS audit_insert ON audit_log;
CREATE POLICY audit_insert ON audit_log
  FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE UPDATE, DELETE ON audit_log FROM partneros_app;

-- storage_objects: tenant-scoped. The malware-scan webhook updates scan_status
-- via the privileged (owner) path, not as partneros_app.
ALTER TABLE storage_objects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storage_isolation ON storage_objects;
CREATE POLICY storage_isolation ON storage_objects
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
