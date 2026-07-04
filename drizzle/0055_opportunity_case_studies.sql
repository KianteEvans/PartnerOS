-- ============================================================================
-- Opportunity <-> case-study links: a rep pins the customer proof points that
-- fit a co-sell deal. Matching itself is derived at read time (pure scorer);
-- this table only stores the curated attachments, so links survive re-scoring
-- and sort first on the Deal Desk.
-- ============================================================================

CREATE TABLE IF NOT EXISTS opportunity_case_studies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  opportunity_id  uuid NOT NULL REFERENCES opportunities (id) ON DELETE CASCADE,
  case_study_id   uuid NOT NULL REFERENCES case_studies (id) ON DELETE CASCADE,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_case_studies_unique
  ON opportunity_case_studies (tenant_id, opportunity_id, case_study_id);
CREATE INDEX IF NOT EXISTS opportunity_case_studies_opp_idx
  ON opportunity_case_studies (tenant_id, opportunity_id);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON opportunity_case_studies TO partneros_app;

ALTER TABLE opportunity_case_studies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS opportunity_case_studies_isolation ON opportunity_case_studies;
CREATE POLICY opportunity_case_studies_isolation ON opportunity_case_studies
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
