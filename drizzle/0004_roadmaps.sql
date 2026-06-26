-- ============================================================================
-- Roadmap Builder — converts readiness findings and objectives into a sequenced
-- partnership plan, then hands finalized milestones off to the Task Manager.
--
-- Two tenant-scoped tables. A roadmap can be sourced from an assessment (its
-- recommendations seed the milestones). On finalize, each milestone spawns a
-- task (source='roadmap', already in task_source). Tenant isolation is RLS.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE roadmap_horizon AS ENUM ('m3', 'm6', 'm9', 'm12', 'm18');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE roadmap_scenario AS ENUM ('conservative', 'standard', 'accelerated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE roadmap_status AS ENUM ('draft', 'finalized');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE roadmap_source AS ENUM ('manual', 'assessment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS roadmaps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name          text NOT NULL,
  objective     text NOT NULL DEFAULT '',
  horizon       roadmap_horizon NOT NULL DEFAULT 'm6',
  scenario      roadmap_scenario NOT NULL DEFAULT 'standard',
  start_date    date NOT NULL,
  status        roadmap_status NOT NULL DEFAULT 'draft',
  source        roadmap_source NOT NULL DEFAULT 'manual',
  source_ref    text,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  finalized_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roadmaps_tenant_idx ON roadmaps (tenant_id);
CREATE INDEX IF NOT EXISTS roadmaps_tenant_status_idx ON roadmaps (tenant_id, status);

CREATE TABLE IF NOT EXISTS roadmap_milestones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  roadmap_id     uuid NOT NULL REFERENCES roadmaps (id) ON DELETE CASCADE,
  sequence       integer NOT NULL,
  title          text NOT NULL,
  detail         text NOT NULL DEFAULT '',
  target_date    date NOT NULL,
  owner_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  depends_on_id  uuid REFERENCES roadmap_milestones (id) ON DELETE SET NULL,
  task_id        uuid REFERENCES tasks (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roadmap_milestones_roadmap_idx
  ON roadmap_milestones (tenant_id, roadmap_id);
CREATE UNIQUE INDEX IF NOT EXISTS roadmap_milestones_sequence_unique
  ON roadmap_milestones (tenant_id, roadmap_id, sequence);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON roadmaps, roadmap_milestones TO partneros_app;

ALTER TABLE roadmaps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roadmaps_isolation ON roadmaps;
CREATE POLICY roadmaps_isolation ON roadmaps
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE roadmap_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roadmap_milestones_isolation ON roadmap_milestones;
CREATE POLICY roadmap_milestones_isolation ON roadmap_milestones
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
