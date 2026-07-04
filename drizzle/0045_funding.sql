-- ============================================================================
-- AWS Funding — a catalog of AWS partner funding programs (MAP, POC credits,
-- ISV Workload Migration, PIF/SIF, WAFR, OLA, workload incentives, ...) with a
-- deal-eligibility matcher and a submission tracker. MDF is one such program and
-- keeps its own deep section; this table tracks applications to the OTHER programs.
--
-- One row per funding submission, carrying the amounts + status through a generic
-- application lifecycle (draft -> submitted -> in_review -> approved|rejected;
-- approved -> funded; non-terminal -> withdrawn). Optionally attributed to an ACE
-- opportunity. Tenant isolation is RLS, same pattern throughout.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE funding_status AS ENUM (
    'draft', 'submitted', 'in_review', 'approved', 'rejected', 'funded', 'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE funding_type AS ENUM ('cash', 'credits');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS funding_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  program_key       text NOT NULL,
  title             text NOT NULL,
  opportunity_id    uuid REFERENCES opportunities (id) ON DELETE SET NULL,
  status            funding_status NOT NULL DEFAULT 'draft',
  funding_type      funding_type NOT NULL DEFAULT 'cash',
  workload_type     text NOT NULL DEFAULT '',
  customer_segment  text NOT NULL DEFAULT '',
  requested_amount  integer NOT NULL DEFAULT 0 CHECK (requested_amount >= 0),
  approved_amount   integer CHECK (approved_amount >= 0),
  currency          text NOT NULL DEFAULT 'USD',
  external_ref      text NOT NULL DEFAULT '',
  deadline          date,
  decision_at       timestamptz,
  decision_notes    text NOT NULL DEFAULT '',
  owner_user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS funding_submissions_tenant_idx ON funding_submissions (tenant_id);
CREATE INDEX IF NOT EXISTS funding_submissions_tenant_status_idx ON funding_submissions (tenant_id, status);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON funding_submissions TO partneros_app;

ALTER TABLE funding_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS funding_submissions_isolation ON funding_submissions;
CREATE POLICY funding_submissions_isolation ON funding_submissions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
