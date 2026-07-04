-- Per-roadmap daily burn-up history for the Trajectory / progress-forecast view.
-- One row per (tenant, roadmap, day), materialized-on-read on the roadmap detail
-- page via an idempotent upsert, so the burn-up line gets a reliable daily series
-- WITHOUT needing a completed-at timestamp on each milestone. New table -> RLS
-- policy + grant. ASCII only (WIN1252 embedded-pg).

CREATE TABLE IF NOT EXISTS roadmap_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id)  ON DELETE CASCADE,
  roadmap_id   uuid NOT NULL REFERENCES roadmaps (id) ON DELETE CASCADE,
  captured_on  date NOT NULL,
  done         integer NOT NULL DEFAULT 0,
  total        integer NOT NULL DEFAULT 0,
  overdue      integer NOT NULL DEFAULT 0,
  in_progress  integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One snapshot per roadmap per day (the upsert target).
CREATE UNIQUE INDEX IF NOT EXISTS roadmap_snapshots_roadmap_day_key
  ON roadmap_snapshots (tenant_id, roadmap_id, captured_on);

GRANT SELECT, INSERT, UPDATE, DELETE ON roadmap_snapshots TO partneros_app;
ALTER TABLE roadmap_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roadmap_snapshots_isolation ON roadmap_snapshots;
CREATE POLICY roadmap_snapshots_isolation ON roadmap_snapshots
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
