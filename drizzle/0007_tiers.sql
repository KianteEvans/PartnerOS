-- ============================================================================
-- Partner Tier Management — track current AWS tier posture and build an
-- evidence-backed advancement plan toward a target tier.
--
-- One plan per tenant (UNIQUE tenant_id). Each plan snapshots the current tier
-- and seeds requirement rows (official thresholds) for the target tier. When all
-- requirements are met, an approved advancement updates tenants.tier. Tenant
-- isolation is RLS, same pattern throughout.
-- ============================================================================

-- Evidence can now be staged from a tier requirement (provenance). DDL-only here.
ALTER TYPE evidence_source ADD VALUE IF NOT EXISTS 'tier';

DO $$ BEGIN
  CREATE TYPE tier_plan_status AS ENUM ('active', 'achieved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tier_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  current_tier     partner_tier NOT NULL,
  target_tier      partner_tier NOT NULL,
  status           tier_plan_status NOT NULL DEFAULT 'active',
  catalog_version  integer NOT NULL,
  owner_user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  target_date      date,
  notes            text NOT NULL DEFAULT '',
  achieved_at      timestamptz,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tier_plans_tenant_unique ON tier_plans (tenant_id);

CREATE TABLE IF NOT EXISTS tier_requirements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  plan_id         uuid NOT NULL REFERENCES tier_plans (id) ON DELETE CASCADE,
  requirement_key text NOT NULL,
  label           text NOT NULL,
  category        text NOT NULL,
  unit            text NOT NULL,
  threshold       integer NOT NULL CHECK (threshold > 0),
  current_value   integer NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  owner_user_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  target_date     date,
  evidence_id     uuid REFERENCES evidence (id) ON DELETE SET NULL,
  task_id         uuid REFERENCES tasks (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tier_requirements_unique
  ON tier_requirements (tenant_id, plan_id, requirement_key);
CREATE INDEX IF NOT EXISTS tier_requirements_plan_idx
  ON tier_requirements (tenant_id, plan_id);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON tier_plans, tier_requirements TO partneros_app;

ALTER TABLE tier_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tier_plans_isolation ON tier_plans;
CREATE POLICY tier_plans_isolation ON tier_plans
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE tier_requirements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tier_requirements_isolation ON tier_requirements;
CREATE POLICY tier_requirements_isolation ON tier_requirements
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
