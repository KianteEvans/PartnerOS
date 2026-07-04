-- ============================================================================
-- Co-sell <-> Marketplace private-offer bridge. A partner-drafted private offer
-- that closes a co-sell opportunity on AWS Marketplace: the OFFER row links the
-- ACE deal (opportunity_id) to the eventual Marketplace transaction (agreement_id)
-- once AWS confirms it. AWS agreements stay the authoritative mirror (synced,
-- read-only); this table is the partner-side artifact that reconciles ONTO an
-- agreement. Same generic tracker arc as funding_submissions:
--   draft -> sent -> accepted | declined | expired ; non-terminal -> withdrawn
-- agreement_id is null until the offer reconciles to a synced agreement.
-- Tenant isolation is RLS, same pattern throughout.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE private_offer_status AS ENUM (
    'draft', 'sent', 'accepted', 'declined', 'expired', 'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS marketplace_private_offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  opportunity_id      uuid REFERENCES opportunities (id) ON DELETE SET NULL,
  listing_id          uuid REFERENCES marketplace_listings (id) ON DELETE SET NULL,
  agreement_id        uuid REFERENCES marketplace_agreements (id) ON DELETE SET NULL,
  title               text NOT NULL,
  customer_identifier text NOT NULL DEFAULT '',
  customer_name       text NOT NULL DEFAULT '',
  offer_value         integer NOT NULL DEFAULT 0 CHECK (offer_value >= 0),
  discount_pct        integer NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  currency            text NOT NULL DEFAULT 'USD',
  status              private_offer_status NOT NULL DEFAULT 'draft',
  expiration_date     date,
  sent_at             timestamptz,
  decided_at          timestamptz,
  notes               text NOT NULL DEFAULT '',
  owner_user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketplace_private_offers_tenant_idx ON marketplace_private_offers (tenant_id);
CREATE INDEX IF NOT EXISTS marketplace_private_offers_tenant_status_idx ON marketplace_private_offers (tenant_id, status);
CREATE INDEX IF NOT EXISTS marketplace_private_offers_tenant_opp_idx ON marketplace_private_offers (tenant_id, opportunity_id);

-- ----------------------------------------------------------------------------
-- Privileges + RLS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_private_offers TO partneros_app;

ALTER TABLE marketplace_private_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_private_offers_isolation ON marketplace_private_offers;
CREATE POLICY marketplace_private_offers_isolation ON marketplace_private_offers
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
