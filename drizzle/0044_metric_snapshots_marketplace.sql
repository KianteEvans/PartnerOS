-- Marketplace KPIs in the workspace-home daily snapshot series (Marketplace "the works"
-- cross-section wiring). Adds published-listing count, active-entitlement count, and
-- attributed-revenue cents to metric_snapshots so the home hub can sparkline marketplace
-- revenue from the same materialized-on-read table as the other hub KPIs. Additive and
-- backfilled to 0 for existing rows. ASCII only (WIN1252 embedded-pg).

ALTER TABLE metric_snapshots
  ADD COLUMN IF NOT EXISTS marketplace_published integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS marketplace_active_entitlements integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS marketplace_attributed_revenue_cents bigint NOT NULL DEFAULT 0;
