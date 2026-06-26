-- ============================================================================
-- Task Manager — the central execution & approval hub.
--
-- One tenant-scoped table. Tasks are either created directly or spawned from an
-- approved action elsewhere in PartnerOS (source + source_ref), which is how
-- cross-section handoffs land here (e.g. an approved assessment recommendation).
-- Tenant isolation is RLS, identical pattern to the other migrations.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('open', 'in_progress', 'blocked', 'done');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Where the task originated. 'manual' is user-created; the rest are handoffs
-- from other sections, keyed by source_ref to the originating object's id.
DO $$ BEGIN
  CREATE TYPE task_source AS ENUM (
    'manual', 'assessment', 'mdf', 'program', 'evidence', 'tier', 'roadmap', 'ace'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',
  status         task_status NOT NULL DEFAULT 'open',
  priority       task_priority NOT NULL DEFAULT 'medium',
  owner_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  due_date       date,
  source         task_source NOT NULL DEFAULT 'manual',
  source_ref     text,
  labels         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_tenant_idx ON tasks (tenant_id);
CREATE INDEX IF NOT EXISTS tasks_tenant_status_idx ON tasks (tenant_id, status);
CREATE INDEX IF NOT EXISTS tasks_tenant_owner_idx ON tasks (tenant_id, owner_user_id);

-- Duplicate prevention for source-linked work: a given (source, source_ref) can
-- map to at most one task per tenant. Manual tasks (source_ref IS NULL) are
-- exempt via the partial predicate.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_source_ref_unique
  ON tasks (tenant_id, source, source_ref)
  WHERE source_ref IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO partneros_app;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tasks_isolation ON tasks;
CREATE POLICY tasks_isolation ON tasks
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
