-- Generalize Competency Applications to all AWS Specialization program types
-- (Service Delivery / Service Ready / MSP / FTR). Label each application with the
-- program type detected from the uploaded workbook. Plain text column; no RLS change.
ALTER TABLE competency_applications
  ADD COLUMN IF NOT EXISTS program_type text NOT NULL DEFAULT '';
