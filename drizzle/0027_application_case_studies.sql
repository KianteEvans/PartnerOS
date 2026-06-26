-- Tier C3: attach reusable case studies to an application, in order, so each maps
-- to a "Customer Reference #N" column when filling the customer-example sheets.

CREATE TABLE IF NOT EXISTS application_case_studies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES competency_applications (id) ON DELETE CASCADE,
  case_study_id  uuid NOT NULL REFERENCES case_studies (id) ON DELETE CASCADE,
  sequence       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS application_case_studies_unique
  ON application_case_studies (tenant_id, application_id, case_study_id);
CREATE INDEX IF NOT EXISTS application_case_studies_app_idx
  ON application_case_studies (tenant_id, application_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON application_case_studies TO partneros_app;
ALTER TABLE application_case_studies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS application_case_studies_isolation ON application_case_studies;
CREATE POLICY application_case_studies_isolation ON application_case_studies
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
