-- Tier D: AWS Solutions -- the validated unit of a Specialization, reusable across
-- applications. Links to ACE opportunities (the 2026 launched-opportunity renewal
-- metric) and to an application (closes the "Solution attached" Tracker row). ASCII.

DO $$ BEGIN
  CREATE TYPE solution_type AS ENUM (
    'software_product', 'hardware_product', 'consulting_service',
    'professional_service', 'managed_service', 'training_service', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE solution_availability AS ENUM ('available', 'beta', 'unsupported');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ftr_status AS ENUM ('none', 'requested', 'approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS solutions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  title               text NOT NULL,
  solution_type       solution_type NOT NULL DEFAULT 'consulting_service',
  program_type        text NOT NULL DEFAULT '',
  description         text NOT NULL DEFAULT '',
  selling_proposition text NOT NULL DEFAULT '',
  availability        solution_availability NOT NULL DEFAULT 'available',
  ftr_status          ftr_status NOT NULL DEFAULT 'none',
  url                 text NOT NULL DEFAULT '',
  marketplace_url     text NOT NULL DEFAULT '',
  renewal_date        date,
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS solutions_tenant_idx ON solutions (tenant_id);

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS solution_id uuid REFERENCES solutions (id) ON DELETE SET NULL;
ALTER TABLE competency_applications
  ADD COLUMN IF NOT EXISTS solution_id uuid REFERENCES solutions (id) ON DELETE SET NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON solutions TO partneros_app;
ALTER TABLE solutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS solutions_isolation ON solutions;
CREATE POLICY solutions_isolation ON solutions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
