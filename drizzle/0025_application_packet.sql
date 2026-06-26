-- Tier B: turn an application into a tracked AWS submission packet -- designation
-- categories + point of contact, and the real AWS application status lifecycle
-- (partner-maintained; distinct from the internal drafting `status`). ASCII only.

DO $$ BEGIN
  CREATE TYPE aws_application_status AS ENUM (
    'draft', 'submitted', 'in_review',
    'tech_validation_requested', 'tech_validation_scheduled', 'tech_validation_in_process',
    'confirmed', 'declined', 'expired', 'pending_partner_action',
    'marketing_update', 'resubmitted', 'deleted'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE competency_applications
  ADD COLUMN IF NOT EXISTS categories   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS poc_name     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS poc_email    text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS poc_role     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS aws_status   aws_application_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
