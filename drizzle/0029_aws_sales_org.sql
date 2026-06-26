-- ACE Sales-Org Intelligence: capture the AWS team per opportunity (AWS Sales Rep,
-- Account Owner, PSM, PDM, ISV SM) pulled from the Partner Central
-- GetAwsOpportunitySummary OpportunityTeam, deduped into ace_relationships and linked
-- to real opportunities via a junction. Powers per-rep open-opp counts + closed-won
-- TCV + by-role/by-account coverage rollups. ASCII only (WIN1252 embedded-pg).

DO $$ BEGIN
  CREATE TYPE aws_org_title AS ENUM
    ('aws_sales_rep', 'aws_account_owner', 'wwps_pdm', 'pdm', 'psm', 'isv_sm');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Dedup key for synced AWS people. Manual relationships keep email='' and are exempt
-- from the partial-unique so they never collide.
ALTER TABLE ace_relationships ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS ace_relationships_tenant_email_key
  ON ace_relationships (tenant_id, lower(email)) WHERE email <> '';

-- AWS-referred opportunities promoted into the editable opportunities table get an
-- external_id (manual opps stay NULL -> separate keyspace, no collisions) + an AWS
-- insight snapshot from GetAwsOpportunitySummary.
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS aws_engagement_score text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS aws_next_best_actions text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS opportunities_tenant_external_key
  ON opportunities (tenant_id, external_id) WHERE external_id IS NOT NULL;

-- Per-opportunity AWS team: which AWS person, in which title, on which deal.
CREATE TABLE IF NOT EXISTS opportunity_aws_team (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  opportunity_id  uuid NOT NULL REFERENCES opportunities (id) ON DELETE CASCADE,
  relationship_id uuid NOT NULL REFERENCES ace_relationships (id) ON DELETE CASCADE,
  title           aws_org_title NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS opp_aws_team_unique
  ON opportunity_aws_team (tenant_id, opportunity_id, relationship_id, title);
CREATE INDEX IF NOT EXISTS opp_aws_team_opp_idx ON opportunity_aws_team (tenant_id, opportunity_id);
CREATE INDEX IF NOT EXISTS opp_aws_team_rel_idx ON opportunity_aws_team (tenant_id, relationship_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON opportunity_aws_team TO partneros_app;
ALTER TABLE opportunity_aws_team ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS opp_aws_team_isolation ON opportunity_aws_team;
CREATE POLICY opp_aws_team_isolation ON opportunity_aws_team
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Opt-in per tenant: team enrichment is one GetAwsOpportunitySummary GET per opportunity.
ALTER TABLE aws_connection ADD COLUMN IF NOT EXISTS enrich_team boolean NOT NULL DEFAULT false;
