-- ============================================================================
-- Onboarding — the guided first-run flow that establishes a tenant's initial
-- partnership context and hands off into the platform.
--
-- Exactly one onboarding record per tenant (UNIQUE tenant_id). On completion it
-- spawns a starter Readiness Assessment and seeds initial tasks, so this section
-- depends on the assessments and tasks domains at runtime. Tenant isolation is
-- RLS, identical pattern to the other migrations.
-- ============================================================================

-- Tasks can now originate from onboarding. Adding an enum value is DDL-only here
-- (no row uses it in this migration), which is safe inside the migration's
-- transaction on PostgreSQL 12+.
ALTER TYPE task_source ADD VALUE IF NOT EXISTS 'onboarding';

DO $$ BEGIN
  CREATE TYPE onboarding_status AS ENUM ('in_progress', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE onboarding_step AS ENUM (
    'context', 'objectives', 'path', 'review', 'done'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE onboarding_path AS ENUM ('foundations', 'growth', 'scale');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS onboarding (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  status         onboarding_status NOT NULL DEFAULT 'in_progress',
  step           onboarding_step NOT NULL DEFAULT 'context',
  company_name   text,
  industry       text,
  partner_type   text,
  aws_stage      text,
  team_size      text,
  objectives     jsonb NOT NULL DEFAULT '[]'::jsonb,
  path           onboarding_path,
  assessment_id  uuid REFERENCES assessments (id) ON DELETE SET NULL,
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- One onboarding record per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_tenant_unique ON onboarding (tenant_id);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding TO partneros_app;

ALTER TABLE onboarding ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS onboarding_isolation ON onboarding;
CREATE POLICY onboarding_isolation ON onboarding
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
