-- Increment 2 of ACE rep-relationship intelligence: a PRECISE opportunity -> AWS
-- contact link (replacing fuzzy account/name matching for scoring), plus an
-- interaction log so touchpoints drive cadence + freshness. Logging a touch bumps
-- the contact's last_contact, so the health score (which reads last_contact) stays
-- current without threading interaction history through the pure scorer.

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS aws_contact_id uuid
  REFERENCES ace_relationships (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS opportunities_tenant_contact_idx
  ON opportunities (tenant_id, aws_contact_id);

DO $$ BEGIN
  CREATE TYPE interaction_type AS ENUM ('meeting', 'email', 'call', 'qbr', 'note');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS ace_interactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  contact_id     uuid NOT NULL REFERENCES ace_relationships (id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES opportunities (id) ON DELETE SET NULL,
  occurred_on    date NOT NULL,
  kind           interaction_type NOT NULL DEFAULT 'meeting',
  note           text NOT NULL DEFAULT '',
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ace_interactions_tenant_idx ON ace_interactions (tenant_id);
CREATE INDEX IF NOT EXISTS ace_interactions_contact_idx ON ace_interactions (tenant_id, contact_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON ace_interactions TO partneros_app;

ALTER TABLE ace_interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ace_interactions_isolation ON ace_interactions;
CREATE POLICY ace_interactions_isolation ON ace_interactions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
