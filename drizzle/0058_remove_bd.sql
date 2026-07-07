-- ============================================================================
-- Remove the Business Development (BD) agent. BD was OBP's own internal outbound
-- sales tool; it has been extracted to a standalone app (BDAgent) and no longer
-- belongs in the partner-facing PartnerOS product. This drops the six bd_* tables
-- and the workspace_settings.bd_automation_mode column.
--
-- demo_requests (the marketing "Book a demo" funnel) STAYS — only its BD claim
-- columns go. Inbound leads now flow to BDAgent over HTTP via the read-only
-- /api/integrations/bd-leads feed (cursor-based; no server-side claim needed).
--
-- Forward-only: never edits applied migrations (0056/0057). ASCII-only.
-- ============================================================================

DROP TABLE IF EXISTS bd_appointments CASCADE;
DROP TABLE IF EXISTS bd_messages CASCADE;
DROP TABLE IF EXISTS bd_sequence_steps CASCADE;
DROP TABLE IF EXISTS bd_prospects CASCADE;
DROP TABLE IF EXISTS bd_sequences CASCADE;
DROP TABLE IF EXISTS bd_calendar_connection CASCADE;

ALTER TABLE workspace_settings DROP COLUMN IF EXISTS bd_automation_mode;

-- BD claim columns on the marketing table (added in 0056) are no longer used.
DROP INDEX IF EXISTS demo_requests_unclaimed_idx;
ALTER TABLE demo_requests DROP COLUMN IF EXISTS imported_by_tenant;
ALTER TABLE demo_requests DROP COLUMN IF EXISTS imported_at;
