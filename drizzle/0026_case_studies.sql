-- Tier C: Case Studies -- a first-class, reusable AWS case study object. Holds the
-- customer-example narrative aspects (about customer / challenge / goals / solution
-- / outcomes) + public/private visibility; draftable by AI from evidence and (in C3)
-- used to fill the customer-example workbook sheets. ASCII only.

DO $$ BEGIN
  CREATE TYPE case_study_visibility AS ENUM ('private', 'public');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS case_studies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  title           text NOT NULL,
  customer_name   text NOT NULL DEFAULT '',
  anonymized      boolean NOT NULL DEFAULT false,
  visibility      case_study_visibility NOT NULL DEFAULT 'private',
  about_customer  text NOT NULL DEFAULT '',
  challenge       text NOT NULL DEFAULT '',
  goals           text NOT NULL DEFAULT '',
  solution        text NOT NULL DEFAULT '',
  outcomes        text NOT NULL DEFAULT '',
  url             text NOT NULL DEFAULT '',
  evidence_id     uuid REFERENCES evidence (id) ON DELETE SET NULL,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_studies_tenant_idx ON case_studies (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON case_studies TO partneros_app;
ALTER TABLE case_studies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS case_studies_isolation ON case_studies;
CREATE POLICY case_studies_isolation ON case_studies
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
