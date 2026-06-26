-- ============================================================================
-- ACE Intelligence — turn AWS account, relationship, and opportunity context
-- into prioritized co-sell action (Prioritize -> Route -> Approve -> Report).
--
-- Two tenant-scoped tables: co-sell opportunities (routed to internal reps;
-- approving routing spawns a follow-up Task) and AWS relationships. Tenant
-- isolation is RLS, same pattern throughout. ('ace' is already a task_source.)
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE opportunity_stage AS ENUM (
    'prospect', 'qualified', 'tech_validation', 'business_validation',
    'committed', 'launched', 'closed_lost'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE opportunity_status AS ENUM ('open', 'won', 'lost');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE opportunity_source AS ENUM (
    'partner_originated', 'amazon_originated', 'marketplace'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE routing_status AS ENUM ('unrouted', 'routed', 'approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE relationship_role AS ENUM (
    'seller', 'solutions_architect', 'partner_manager', 'leadership', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS opportunities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name              text NOT NULL,
  account_name      text NOT NULL DEFAULT '',
  stage             opportunity_stage NOT NULL DEFAULT 'prospect',
  status            opportunity_status NOT NULL DEFAULT 'open',
  amount            integer NOT NULL DEFAULT 0 CHECK (amount >= 0),
  source            opportunity_source NOT NULL DEFAULT 'partner_originated',
  owner_user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  aws_seller        text,
  next_step         text NOT NULL DEFAULT '',
  last_interaction  date,
  close_date        date,
  routing_status    routing_status NOT NULL DEFAULT 'unrouted',
  task_id           uuid REFERENCES tasks (id) ON DELETE SET NULL,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS opportunities_tenant_idx ON opportunities (tenant_id);
CREATE INDEX IF NOT EXISTS opportunities_tenant_status_idx ON opportunities (tenant_id, status);
CREATE INDEX IF NOT EXISTS opportunities_tenant_owner_idx ON opportunities (tenant_id, owner_user_id);

CREATE TABLE IF NOT EXISTS ace_relationships (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name           text NOT NULL,
  role           relationship_role NOT NULL DEFAULT 'seller',
  account_name   text NOT NULL DEFAULT '',
  strength       integer NOT NULL DEFAULT 0 CHECK (strength BETWEEN 0 AND 100),
  last_contact   date,
  owner_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  notes          text NOT NULL DEFAULT '',
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ace_relationships_tenant_idx ON ace_relationships (tenant_id);
CREATE INDEX IF NOT EXISTS ace_relationships_tenant_account_idx ON ace_relationships (tenant_id, account_name);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON opportunities, ace_relationships TO partneros_app;

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS opportunities_isolation ON opportunities;
CREATE POLICY opportunities_isolation ON opportunities
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE ace_relationships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ace_relationships_isolation ON ace_relationships;
CREATE POLICY ace_relationships_isolation ON ace_relationships
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
