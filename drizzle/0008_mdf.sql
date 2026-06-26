-- ============================================================================
-- MDF Management — plan, request, approve, deploy, claim, and reimburse AWS
-- Market Development Funds, with eligibility preflight, proof linkage, and ROI.
--
-- One row per MDF request, carrying the amounts at each lifecycle stage
-- (requested -> approved -> deployed -> claimed -> reimbursed). Proof of
-- performance links to Evidence; work hands off to Tasks. Tenant isolation is
-- RLS, same pattern throughout. The mdf:* permissions were stubbed in 0000.
-- ============================================================================

-- Proof-of-performance evidence can be staged from an MDF request (provenance).
ALTER TYPE evidence_source ADD VALUE IF NOT EXISTS 'mdf';

DO $$ BEGIN
  CREATE TYPE mdf_activity_type AS ENUM (
    'event', 'campaign', 'content', 'enablement', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mdf_status AS ENUM (
    'draft', 'requested', 'approved', 'rejected', 'deployed', 'claimed', 'reimbursed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS mdf_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  title              text NOT NULL,
  activity_type      mdf_activity_type NOT NULL DEFAULT 'other',
  status             mdf_status NOT NULL DEFAULT 'draft',
  currency           text NOT NULL DEFAULT 'USD',
  requested_amount   integer NOT NULL DEFAULT 0 CHECK (requested_amount >= 0),
  approved_amount    integer CHECK (approved_amount >= 0),
  deployed_amount    integer CHECK (deployed_amount >= 0),
  claimed_amount     integer CHECK (claimed_amount >= 0),
  reimbursed_amount  integer CHECK (reimbursed_amount >= 0),
  expected_pipeline  integer NOT NULL DEFAULT 0 CHECK (expected_pipeline >= 0),
  owner_user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  start_date         date,
  end_date           date,
  claim_deadline     date,
  opportunity_ref    text,
  evidence_id        uuid REFERENCES evidence (id) ON DELETE SET NULL,
  task_id            uuid REFERENCES tasks (id) ON DELETE SET NULL,
  review_notes       text NOT NULL DEFAULT '',
  created_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  submitted_at       timestamptz,
  approved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mdf_requests_tenant_idx ON mdf_requests (tenant_id);
CREATE INDEX IF NOT EXISTS mdf_requests_tenant_status_idx ON mdf_requests (tenant_id, status);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON mdf_requests TO partneros_app;

ALTER TABLE mdf_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mdf_requests_isolation ON mdf_requests;
CREATE POLICY mdf_requests_isolation ON mdf_requests
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
