-- ============================================================================
-- BD agent Phase 3 -- Google Calendar scheduling. Connects OBP's calendar (ONE
-- shared per-tenant connection, like aws_connection), so the agent can read real
-- free/busy and a rep can book a real event (with a Meet link). Booking writes an
-- appointment + an approval-gated meeting_confirm message.
--
--   bd_calendar_connection   per-tenant OAuth connection; tokens ENCRYPTED at rest
--   bd_appointments          booked meetings (Google event id + Meet link)
--
-- status/provider stay TEXT so Outlook/other providers can follow. Token columns
-- hold AES-256-GCM ciphertext (see src/lib/encryption.ts) -- never plaintext.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- bd_calendar_connection -- one shared calendar per tenant (PK = tenant_id)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bd_calendar_connection (
  tenant_id          uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  access_token_enc   text NOT NULL DEFAULT '',
  refresh_token_enc  text NOT NULL DEFAULT '',
  token_expires_at   timestamptz,
  calendar_id        text NOT NULL DEFAULT 'primary',
  account_email      text NOT NULL DEFAULT '',
  enabled            boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'not_configured',
  last_error         text,
  created_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- bd_appointments -- booked meetings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bd_appointments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  prospect_id       uuid NOT NULL REFERENCES bd_prospects (id) ON DELETE CASCADE,
  provider          text NOT NULL DEFAULT 'google',
  external_event_id text NOT NULL DEFAULT '',
  start_at          timestamptz NOT NULL,
  end_at            timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'confirmed',
  meet_url          text NOT NULL DEFAULT '',
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bd_appointments_tenant_prospect_idx
  ON bd_appointments (tenant_id, prospect_id);

-- ----------------------------------------------------------------------------
-- Privileges + RLS (same pattern throughout the app)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON bd_calendar_connection TO partneros_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bd_appointments TO partneros_app;

ALTER TABLE bd_calendar_connection ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bd_calendar_connection_isolation ON bd_calendar_connection;
CREATE POLICY bd_calendar_connection_isolation ON bd_calendar_connection
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE bd_appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bd_appointments_isolation ON bd_appointments;
CREATE POLICY bd_appointments_isolation ON bd_appointments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
