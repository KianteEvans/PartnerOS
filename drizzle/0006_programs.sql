-- ============================================================================
-- Program Management — discovery, readiness, eligibility, submission, and
-- renewal of AWS programs.
--
-- A tenant adopts programs from the static Program Library (domain/programs/
-- library.ts); each adopted program seeds a requirement checklist. Requirements
-- link to Evidence and Tasks. Tenant isolation is RLS, same pattern throughout.
-- ============================================================================

-- Evidence can now be staged from a program requirement (provenance). DDL-only
-- here (no row uses it in this migration), safe inside the transaction on PG 12+.
ALTER TYPE evidence_source ADD VALUE IF NOT EXISTS 'program';

DO $$ BEGIN
  CREATE TYPE program_status AS ENUM ('pending', 'submitted', 'active', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE requirement_status AS ENUM ('open', 'met', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS programs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  library_key      text NOT NULL,
  name             text NOT NULL,
  program_type     text NOT NULL,
  delivery_model   text NOT NULL,
  funding_fit      text NOT NULL,
  status           program_status NOT NULL DEFAULT 'pending',
  owner_user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  target_date      date,
  expiration_date  date,
  notes            text NOT NULL DEFAULT '',
  submitted_at     timestamptz,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- A library program appears at most once in a tenant's portfolio.
CREATE UNIQUE INDEX IF NOT EXISTS programs_tenant_library_unique
  ON programs (tenant_id, library_key);
CREATE INDEX IF NOT EXISTS programs_tenant_idx ON programs (tenant_id);
CREATE INDEX IF NOT EXISTS programs_tenant_status_idx ON programs (tenant_id, status);

CREATE TABLE IF NOT EXISTS program_requirements (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  program_id             uuid NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
  requirement_key        text NOT NULL,
  label                  text NOT NULL,
  expected_evidence_type text NOT NULL,
  status                 requirement_status NOT NULL DEFAULT 'open',
  owner_user_id          uuid REFERENCES users (id) ON DELETE SET NULL,
  target_date            date,
  evidence_id            uuid REFERENCES evidence (id) ON DELETE SET NULL,
  task_id                uuid REFERENCES tasks (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS program_requirements_unique
  ON program_requirements (tenant_id, program_id, requirement_key);
CREATE INDEX IF NOT EXISTS program_requirements_program_idx
  ON program_requirements (tenant_id, program_id);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON programs, program_requirements TO partneros_app;

ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS programs_isolation ON programs;
CREATE POLICY programs_isolation ON programs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE program_requirements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS program_requirements_isolation ON program_requirements;
CREATE POLICY program_requirements_isolation ON program_requirements
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
