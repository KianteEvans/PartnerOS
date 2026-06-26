-- Competency ROI: attribute an ACE opportunity to the Competency program it was won
-- under (program_id) and stamp when a program was achieved (achieved_at), so the
-- platform can report per-competency open/won/launched TCV plus a conservative
-- "won since achieved" influence number. Columns on existing tables only -> the
-- table-level RLS policies + partneros_app grants already cover them (no re-grant,
-- mirroring 0029 adding opportunities.external_id). ASCII only (WIN1252 embedded-pg).

-- One primary Competency credited per deal (single FK, like solution_id). NULL = not
-- attributed. ON DELETE SET NULL preserves the deal if the program is removed.
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES programs (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS opportunities_tenant_program_idx
  ON opportunities (tenant_id, program_id);

-- When a program reached "active". Stamped on the status transition going forward;
-- backfilled below for programs already active (which never re-transition).
ALTER TABLE programs ADD COLUMN IF NOT EXISTS achieved_at date;
UPDATE programs
  SET achieved_at = (updated_at AT TIME ZONE 'UTC')::date
  WHERE status = 'active' AND achieved_at IS NULL;
