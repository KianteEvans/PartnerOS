-- ============================================================================
-- Saved views — per-user list presets. A user configures any list page (its
-- view filter, search term, sort) and saves that combination by name; the saved
-- view re-applies those URL params in one click. Views are PRIVATE to the user
-- who created them: RLS keys off BOTH app.tenant_id and app.user_id, so one
-- teammate never sees (or can delete) another's presets, even within a tenant.
--
-- `query` is the normalized URL query string the list page reads back via its
-- existing parseListParams (e.g. 'sort=created&view=overdue'); storing the raw
-- string keeps this list-agnostic — no column per filter.
-- ============================================================================

CREATE TABLE IF NOT EXISTS saved_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  list_key    text NOT NULL,
  name        text NOT NULL,
  query       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One name per (user, list); re-saving a name overwrites its query (upsert).
CREATE UNIQUE INDEX IF NOT EXISTS saved_views_unique
  ON saved_views (tenant_id, user_id, list_key, name);
CREATE INDEX IF NOT EXISTS saved_views_lookup_idx
  ON saved_views (tenant_id, user_id, list_key);

-- ----------------------------------------------------------------------------
-- Privileges + RLS (tenant AND user scoped)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_views TO partneros_app;

ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_views_isolation ON saved_views;
CREATE POLICY saved_views_isolation ON saved_views
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
