-- ============================================================================
-- BD agent Phase 2 -- outreach SEQUENCES + auto-sent follow-up nudges. Adds a
-- cadence engine on top of Phase 1's prospect pipeline: a prospect is enrolled in
-- a sequence, and the runner (materialize-on-read + token-gated cron, mirroring
-- the playbook engine) materializes each due step ONCE, drafting a follow-up nudge
-- and -- under a DEDICATED bd_automation_mode -- either sending it or holding it
-- for approval. First-touch/meeting-confirm stay approval-gated (governance floor).
--
--   bd_sequences        one named cadence per row (enable/disable)
--   bd_sequence_steps   ordered steps (delay + drafting instruction)
--
-- kind/status stay TEXT (no migration for new values). bd_automation_mode reuses
-- the existing automation_mode enum but is INDEPENDENT of the playbook mode.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- bd_sequences -- named follow-up cadences
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bd_sequences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name        text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bd_sequences_tenant_idx ON bd_sequences (tenant_id);

-- ----------------------------------------------------------------------------
-- bd_sequence_steps -- ordered steps within a sequence
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bd_sequence_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  sequence_id  uuid NOT NULL REFERENCES bd_sequences (id) ON DELETE CASCADE,
  step_index   integer NOT NULL,
  kind         text NOT NULL DEFAULT 'follow_up_nudge',
  delay_days   integer NOT NULL DEFAULT 3,
  instruction  text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bd_sequence_steps_seq_idx ON bd_sequence_steps (sequence_id);
CREATE UNIQUE INDEX IF NOT EXISTS bd_sequence_steps_order_unique
  ON bd_sequence_steps (tenant_id, sequence_id, step_index);

-- ----------------------------------------------------------------------------
-- bd_prospects -- enrollment in one cadence
-- ----------------------------------------------------------------------------
ALTER TABLE bd_prospects ADD COLUMN IF NOT EXISTS sequence_id uuid REFERENCES bd_sequences (id) ON DELETE SET NULL;
ALTER TABLE bd_prospects ADD COLUMN IF NOT EXISTS enrolled_at timestamptz;
CREATE INDEX IF NOT EXISTS bd_prospects_tenant_sequence_idx ON bd_prospects (tenant_id, sequence_id);

-- ----------------------------------------------------------------------------
-- bd_messages -- link a message to its sequence step; fire-once per step
-- ----------------------------------------------------------------------------
ALTER TABLE bd_messages ADD COLUMN IF NOT EXISTS sequence_id uuid REFERENCES bd_sequences (id) ON DELETE SET NULL;
ALTER TABLE bd_messages ADD COLUMN IF NOT EXISTS step_index integer;
ALTER TABLE bd_messages ADD COLUMN IF NOT EXISTS auto_sent boolean NOT NULL DEFAULT false;
-- Each sequence step materializes at most one message per prospect.
CREATE UNIQUE INDEX IF NOT EXISTS bd_messages_step_fire_once
  ON bd_messages (tenant_id, prospect_id, sequence_id, step_index)
  WHERE step_index IS NOT NULL;

-- ----------------------------------------------------------------------------
-- workspace_settings -- dedicated BD autonomy, independent of the playbook mode
-- ----------------------------------------------------------------------------
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS bd_automation_mode automation_mode NOT NULL DEFAULT 'recommend_only';

-- ----------------------------------------------------------------------------
-- Privileges + RLS (same pattern throughout the app)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON bd_sequences TO partneros_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bd_sequence_steps TO partneros_app;

ALTER TABLE bd_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bd_sequences_isolation ON bd_sequences;
CREATE POLICY bd_sequences_isolation ON bd_sequences
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE bd_sequence_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bd_sequence_steps_isolation ON bd_sequence_steps;
CREATE POLICY bd_sequence_steps_isolation ON bd_sequence_steps
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
