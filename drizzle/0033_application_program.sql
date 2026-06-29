-- Link a competency self-assessment Application to an adopted Program, so the
-- competency detail page can surface its own application(s) (the "Submit" stage of
-- the Program Management lifecycle). Nullable + ON DELETE SET NULL: an application
-- can exist before it is tied to a program, and dropping a program leaves it intact.
ALTER TABLE competency_applications
  ADD COLUMN program_id uuid REFERENCES programs(id) ON DELETE SET NULL;

CREATE INDEX competency_applications_program_idx
  ON competency_applications (tenant_id, program_id);

-- Best-effort backfill: tie existing applications to an adopted program of the same
-- name within the same tenant. New/unmatched ones are linked from the detail page.
UPDATE competency_applications ca
SET program_id = p.id
FROM programs p
WHERE p.tenant_id = ca.tenant_id
  AND ca.competency = p.name
  AND ca.program_id IS NULL;
