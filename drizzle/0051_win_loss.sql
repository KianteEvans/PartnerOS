-- ============================================================================
-- Win/loss mining capture. Two honest-close columns on opportunities:
--   loss_reason: WHY a deal was lost (app-validated catalog: competitor | price |
--                timing | no_budget | scope | other; '' = not recorded). Cleared
--                when a deal is won or reopened.
--   closed_at:   the actual close timestamp, stamped when status transitions into
--                won/lost (close_date remains the user-set TARGET date). Backfilled
--                from updated_at for already-closed rows (approximate but honest).
-- No new RLS: existing tenant-isolated table.
-- ============================================================================

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS loss_reason text NOT NULL DEFAULT '';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS closed_at timestamptz;

UPDATE opportunities SET closed_at = updated_at WHERE status IN ('won', 'lost') AND closed_at IS NULL;
