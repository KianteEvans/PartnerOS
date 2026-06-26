-- ============================================================================
-- AWS Competency Applications -- a partner uploads an AWS Competency
-- Self-Assessment workbook; the platform drafts a submission-appropriate
-- "Partner Response" + "Met?" per control, grounded in the Evidence Locker, then
-- exports a filled copy of the same workbook. Parent (competency_applications) +
-- children (application_controls). Tenant isolation is RLS, same pattern as
-- programs/roadmaps.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE application_status AS ENUM ('draft', 'generating', 'ready', 'exported');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE application_control_status AS ENUM ('open', 'generated', 'accepted', 'edited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE application_met AS ENUM ('unknown', 'yes', 'no', 'partial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS competency_applications (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name                     text NOT NULL,
  competency               text NOT NULL DEFAULT '',
  source_storage_object_id uuid REFERENCES storage_objects (id) ON DELETE SET NULL,
  source_file_name         text NOT NULL DEFAULT '',
  status                   application_status NOT NULL DEFAULT 'draft',
  control_count            integer NOT NULL DEFAULT 0,
  accepted_count           integer NOT NULL DEFAULT 0,
  created_by               uuid REFERENCES users (id) ON DELETE SET NULL,
  exported_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS competency_applications_tenant_idx
  ON competency_applications (tenant_id);
CREATE INDEX IF NOT EXISTS competency_applications_tenant_status_idx
  ON competency_applications (tenant_id, status);

CREATE TABLE IF NOT EXISTS application_controls (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  application_id       uuid NOT NULL REFERENCES competency_applications (id) ON DELETE CASCADE,
  sheet_name           text NOT NULL,
  control_id           text NOT NULL,
  requirement_text     text NOT NULL,
  section              text NOT NULL DEFAULT '',
  response_target      jsonb NOT NULL DEFAULT '[]'::jsonb,
  example_response     text NOT NULL DEFAULT '',
  recommended_response text NOT NULL DEFAULT '',
  met_suggestion       application_met NOT NULL DEFAULT 'unknown',
  ai_confidence        integer NOT NULL DEFAULT 0,
  ai_reasoning         text NOT NULL DEFAULT '',
  linked_evidence_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
  status               application_control_status NOT NULL DEFAULT 'open',
  sequence             integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS application_controls_unique
  ON application_controls (tenant_id, application_id, sheet_name, control_id);
CREATE INDEX IF NOT EXISTS application_controls_app_idx
  ON application_controls (tenant_id, application_id);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON competency_applications, application_controls TO partneros_app;

ALTER TABLE competency_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competency_applications_isolation ON competency_applications;
CREATE POLICY competency_applications_isolation ON competency_applications
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE application_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS application_controls_isolation ON application_controls;
CREATE POLICY application_controls_isolation ON application_controls
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
