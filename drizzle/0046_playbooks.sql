-- ============================================================================
-- Automation & Playbook engine — turns the passive cross-domain decision queue
-- (deriveDecisions -> 14 situations) into an ACTIVE engine: rules that fire real
-- actions (create task / route opportunity / auto-approve within a cap / generate
-- report / notify), gated by the existing automation_mode governance, plus a
-- delivery last mile (in-app + email + webhook). ACE has no partner-side workflow
-- engine; this is the deepest "impossible in ACE" operations moat.
--
--   playbooks             one rule per row: trigger situation -> action, + channels
--   playbook_runs         one row per (playbook fires on a decision); fire-once ledger
--   notifications         persisted, deliverable in-app notifications (+ email/webhook status)
--   notification_webhooks per-tenant outbound webhook targets (Slack-compatible)
--
-- trigger/action/status are TEXT (not enums) so new situations/actions never need a
-- migration, mirroring funding.program_key. Tenant isolation is RLS throughout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- playbooks — the rule definitions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS playbooks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name                 text NOT NULL,
  description          text NOT NULL DEFAULT '',
  enabled              boolean NOT NULL DEFAULT true,
  trigger_situation    text NOT NULL,
  trigger_min_severity text NOT NULL DEFAULT 'medium',
  condition            jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type          text NOT NULL,
  action_params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  channels             jsonb NOT NULL DEFAULT '["in_app"]'::jsonb,
  created_by           uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS playbooks_tenant_idx ON playbooks (tenant_id);
CREATE INDEX IF NOT EXISTS playbooks_tenant_enabled_idx ON playbooks (tenant_id, enabled);

-- ----------------------------------------------------------------------------
-- playbook_runs — one row per time a playbook fires on a decision (fire-once)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS playbook_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  playbook_id   uuid NOT NULL REFERENCES playbooks (id) ON DELETE CASCADE,
  decision_id   text NOT NULL,
  decision      jsonb NOT NULL DEFAULT '{}'::jsonb,
  verdict       text NOT NULL,
  status        text NOT NULL DEFAULT 'recommended',
  result        jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_at   timestamptz,
  executed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- A given playbook fires at most once per triggering decision.
CREATE UNIQUE INDEX IF NOT EXISTS playbook_runs_fire_once
  ON playbook_runs (tenant_id, playbook_id, decision_id);
CREATE INDEX IF NOT EXISTS playbook_runs_tenant_status_idx ON playbook_runs (tenant_id, status);

-- ----------------------------------------------------------------------------
-- notifications — persisted, deliverable in-app notifications
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id          uuid REFERENCES users (id) ON DELETE CASCADE,
  source           text NOT NULL DEFAULT 'playbook',
  playbook_run_id  uuid REFERENCES playbook_runs (id) ON DELETE SET NULL,
  severity         text NOT NULL DEFAULT 'medium',
  title            text NOT NULL,
  body             text NOT NULL DEFAULT '',
  link             text NOT NULL DEFAULT '',
  dedupe_key       text NOT NULL,
  read_at          timestamptz,
  email_status     text NOT NULL DEFAULT 'none',
  webhook_status   text NOT NULL DEFAULT 'none',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe ON notifications (tenant_id, dedupe_key);
CREATE INDEX IF NOT EXISTS notifications_tenant_user_read_idx ON notifications (tenant_id, user_id, read_at);

-- ----------------------------------------------------------------------------
-- notification_webhooks — per-tenant outbound webhook targets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_webhooks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  url         text NOT NULL,
  secret      text NOT NULL DEFAULT '',
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_webhooks_tenant_idx ON notification_webhooks (tenant_id);

-- ----------------------------------------------------------------------------
-- Privileges + RLS (same pattern throughout the app)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON playbooks TO partneros_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON playbook_runs TO partneros_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO partneros_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_webhooks TO partneros_app;

ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS playbooks_isolation ON playbooks;
CREATE POLICY playbooks_isolation ON playbooks
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE playbook_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS playbook_runs_isolation ON playbook_runs;
CREATE POLICY playbook_runs_isolation ON playbook_runs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_isolation ON notifications;
CREATE POLICY notifications_isolation ON notifications
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE notification_webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_webhooks_isolation ON notification_webhooks;
CREATE POLICY notification_webhooks_isolation ON notification_webhooks
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
