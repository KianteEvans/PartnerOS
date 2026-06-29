-- Public "Book a demo" intake from the marketing site. These are vendor-level
-- sales leads, NOT tenant data: there is no tenant_id and NO row-level security.
-- Rows are written by the unauthenticated landing form through withSystem() (the
-- same privileged, pre-identity path used for provisioning) and are intentionally
-- NOT granted to the partneros_app role, so no tenant can read another's leads --
-- only an operator (table owner) can. ASCII only (WIN1252 embedded-pg).

CREATE TABLE IF NOT EXISTS demo_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text NOT NULL,
  company     text NOT NULL,
  team_size   text,
  message     text,
  status      text NOT NULL DEFAULT 'new',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_requests_created_idx ON demo_requests (created_at DESC);
