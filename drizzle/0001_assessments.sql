-- ============================================================================
-- Readiness Assessments — the first domain feature.
--
-- Four tenant-scoped tables. Tenant isolation is enforced HERE by RLS (Rule 2),
-- exactly as in 0000_init.sql: every policy compares tenant_id against the
-- transaction-local `app.tenant_id` GUC via
--   NULLIF(current_setting('app.tenant_id', true), '')::uuid
-- so an unset or pooled-revert-to-empty GUC yields NULL and filters every row
-- (fail closed). The non-privileged `partneros_app` role (created in 0000) gets
-- DML only; it owns nothing and cannot bypass RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE assessment_preset AS ENUM (
    'program_submission', 'growth_funding', 'tier_advancement', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE assessment_status AS ENUM ('draft', 'scored');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE assessment_module AS ENUM (
    'gtm', 'competency', 'specialization', 'partner_tier',
    'marketplace', 'mdf', 'evidence'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE recommendation_type AS ENUM (
    'program', 'evidence_gap', 'task', 'milestone'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE recommendation_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- An assessment is a single readiness evaluation. It starts as a 'draft' the
-- user fills in, then becomes 'scored' atomically at submit time (no observable
-- intermediate state). catalog_version is stamped at create time so a scored
-- assessment stays reproducible even after the question catalog is revised.
CREATE TABLE IF NOT EXISTS assessments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name            text NOT NULL,
  preset          assessment_preset NOT NULL,
  target_program  text,
  status          assessment_status NOT NULL DEFAULT 'draft',
  catalog_version integer NOT NULL,
  overall_score   integer CHECK (overall_score BETWEEN 0 AND 100),
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  submitted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS assessments_tenant_idx ON assessments (tenant_id);
CREATE INDEX IF NOT EXISTS assessments_tenant_status_idx ON assessments (tenant_id, status);

-- One row per module in the assessment's scope, holding its computed score.
CREATE TABLE IF NOT EXISTS assessment_modules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  assessment_id  uuid NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
  module         assessment_module NOT NULL,
  score          integer CHECK (score BETWEEN 0 AND 100),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_modules_unique
  ON assessment_modules (tenant_id, assessment_id, module);
CREATE INDEX IF NOT EXISTS assessment_modules_assessment_idx
  ON assessment_modules (tenant_id, assessment_id);

-- Saved answers (one per catalog question_key). Upserted on every draft save so
-- the form is resumable; last-write-wins per key.
CREATE TABLE IF NOT EXISTS assessment_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  assessment_id  uuid NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
  module         assessment_module NOT NULL,
  question_key   text NOT NULL,
  value          jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_responses_unique
  ON assessment_responses (tenant_id, assessment_id, question_key);
CREATE INDEX IF NOT EXISTS assessment_responses_assessment_idx
  ON assessment_responses (tenant_id, assessment_id);

-- Approval-gated downstream actions generated at submit time. Each is reviewed
-- by a human (pending -> approved/rejected) before any later domain consumes it.
CREATE TABLE IF NOT EXISTS assessment_recommendations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  assessment_id  uuid NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
  type           recommendation_type NOT NULL,
  title          text NOT NULL,
  detail         text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence     integer NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  status         recommendation_status NOT NULL DEFAULT 'pending',
  reviewed_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessment_recs_assessment_idx
  ON assessment_recommendations (tenant_id, assessment_id);
CREATE INDEX IF NOT EXISTS assessment_recs_status_idx
  ON assessment_recommendations (tenant_id, status);

-- ----------------------------------------------------------------------------
-- Privileges: partneros_app gets DML only. No DDL, no ownership.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  assessments, assessment_modules, assessment_responses, assessment_recommendations
  TO partneros_app;

-- ----------------------------------------------------------------------------
-- Row-Level Security. Same NULL-safe tenant predicate as every other table.
-- ----------------------------------------------------------------------------
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assessments_isolation ON assessments;
CREATE POLICY assessments_isolation ON assessments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE assessment_modules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assessment_modules_isolation ON assessment_modules;
CREATE POLICY assessment_modules_isolation ON assessment_modules
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE assessment_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assessment_responses_isolation ON assessment_responses;
CREATE POLICY assessment_responses_isolation ON assessment_responses
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE assessment_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assessment_recs_isolation ON assessment_recommendations;
CREATE POLICY assessment_recs_isolation ON assessment_recommendations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
