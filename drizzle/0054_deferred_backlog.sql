-- ============================================================================
-- Deferred backlog wave: (1) Solution -> program back-link, (2) snooze-style
-- dismissal of derived Command Center decisions.
-- ============================================================================

-- 1. Which adopted program a Solution belongs to. Nullable: a Solution can
--    predate (or outlive) the competency it proves; deleting the program
--    detaches the Solution, never deletes it.
ALTER TABLE solutions
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES programs (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS solutions_program_idx ON solutions (tenant_id, program_id);

-- 2. Tenant-wide snooze of derived decisions. decision_id is the deterministic
--    derived id (e.g. 'task-overdue-<uuid>'), NOT a foreign key: decisions are
--    recomputed per request, so a dismissal simply filters the derived set
--    until dismissed_until passes. Rows are reused via upsert; expired rows
--    are inert (no cleanup job needed).
CREATE TABLE IF NOT EXISTS decision_dismissals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  decision_id     text NOT NULL,
  dismissed_until date NOT NULL,
  dismissed_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS decision_dismissals_unique
  ON decision_dismissals (tenant_id, decision_id);
CREATE INDEX IF NOT EXISTS decision_dismissals_until_idx
  ON decision_dismissals (tenant_id, dismissed_until);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON decision_dismissals TO partneros_app;

ALTER TABLE decision_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decision_dismissals_isolation ON decision_dismissals;
CREATE POLICY decision_dismissals_isolation ON decision_dismissals
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
