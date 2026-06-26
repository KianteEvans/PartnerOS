-- ============================================================================
-- Evidence Locker — a governed evidence system for AWS programs, tier
-- advancement, MDF, reporting, and renewals.
--
-- Each evidence record carries lifecycle, ownership, quality, and expiration
-- metadata, and optionally links to a scanned file in storage_objects. Files are
-- fail-closed: downloadable only once the malware scan flips them to 'clean'
-- (storage/malware-scan.ts). Tenant isolation is RLS, same pattern throughout.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE evidence_type AS ENUM (
    'case_study', 'certification', 'architecture', 'security',
    'billing', 'reference', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE evidence_status AS ENUM (
    'missing', 'collected', 'in_review', 'approved', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE evidence_source AS ENUM ('manual', 'assessment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS evidence (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  title              text NOT NULL,
  evidence_type      evidence_type NOT NULL DEFAULT 'other',
  status             evidence_status NOT NULL DEFAULT 'missing',
  program            text,
  owner_user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  quality_score      integer CHECK (quality_score BETWEEN 0 AND 100),
  reusable           boolean NOT NULL DEFAULT false,
  due_date           date,
  expiration_date    date,
  review_notes       text NOT NULL DEFAULT '',
  file_name          text,
  storage_object_id  uuid REFERENCES storage_objects (id) ON DELETE SET NULL,
  source             evidence_source NOT NULL DEFAULT 'manual',
  source_ref         text,
  created_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_tenant_idx ON evidence (tenant_id);
CREATE INDEX IF NOT EXISTS evidence_tenant_status_idx ON evidence (tenant_id, status);
CREATE INDEX IF NOT EXISTS evidence_tenant_owner_idx ON evidence (tenant_id, owner_user_id);

-- Idempotent handoff: an assessment recommendation maps to at most one evidence
-- record per tenant. Manual records (source_ref IS NULL) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS evidence_source_ref_unique
  ON evidence (tenant_id, source, source_ref)
  WHERE source_ref IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON evidence TO partneros_app;

ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_isolation ON evidence;
CREATE POLICY evidence_isolation ON evidence
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
