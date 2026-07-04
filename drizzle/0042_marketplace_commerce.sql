-- AWS Marketplace -- Commerce (entitlements + agreements + charges). Mirror projection,
-- read-only from AWS: entitlements from the Entitlement API (GetEntitlements), agreements
-- and charges from the Agreement API (SearchAgreements / ListAgreementCharges /
-- ListAgreementInvoiceLineItems). Money in integer cents. Status/offer kept as free text
-- to faithfully mirror AWS-side vocabularies. ASCII.

CREATE TABLE IF NOT EXISTS marketplace_entitlements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  entitlement_id      text NOT NULL,
  listing_id          uuid REFERENCES marketplace_listings (id) ON DELETE SET NULL,
  customer_identifier text NOT NULL DEFAULT '',
  dimension           text NOT NULL DEFAULT '',
  value               integer NOT NULL DEFAULT 0,
  expiration_date     date,
  agreement_id        text NOT NULL DEFAULT '',
  last_synced_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_entitlements_unique
  ON marketplace_entitlements (tenant_id, entitlement_id);
CREATE INDEX IF NOT EXISTS marketplace_entitlements_listing_idx
  ON marketplace_entitlements (tenant_id, listing_id);

CREATE TABLE IF NOT EXISTS marketplace_agreements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  agreement_id        text NOT NULL,
  listing_id          uuid REFERENCES marketplace_listings (id) ON DELETE SET NULL,
  customer_identifier text NOT NULL DEFAULT '',
  offer_type          text NOT NULL DEFAULT '',
  status              text NOT NULL DEFAULT '',
  start_date          date,
  end_date            date,
  auto_renew          boolean NOT NULL DEFAULT false,
  total_value         integer NOT NULL DEFAULT 0,
  acceptance_time     timestamptz,
  last_synced_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_agreements_unique
  ON marketplace_agreements (tenant_id, agreement_id);
CREATE INDEX IF NOT EXISTS marketplace_agreements_listing_idx
  ON marketplace_agreements (tenant_id, listing_id);

CREATE TABLE IF NOT EXISTS marketplace_charges (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  charge_ref           text NOT NULL DEFAULT '',
  agreement_id         text NOT NULL DEFAULT '',
  listing_id           uuid REFERENCES marketplace_listings (id) ON DELETE SET NULL,
  billing_period_start date,
  billing_period_end   date,
  dimension            text NOT NULL DEFAULT '',
  quantity             integer NOT NULL DEFAULT 0,
  -- Charge amount in integer cents. USD.
  amount               integer NOT NULL DEFAULT 0,
  invoice_line_item    text NOT NULL DEFAULT '',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_charges_unique
  ON marketplace_charges (tenant_id, charge_ref);
CREATE INDEX IF NOT EXISTS marketplace_charges_agreement_idx
  ON marketplace_charges (tenant_id, agreement_id);
CREATE INDEX IF NOT EXISTS marketplace_charges_listing_idx
  ON marketplace_charges (tenant_id, listing_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_entitlements TO partneros_app;
ALTER TABLE marketplace_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_entitlements_isolation ON marketplace_entitlements;
CREATE POLICY marketplace_entitlements_isolation ON marketplace_entitlements
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_agreements TO partneros_app;
ALTER TABLE marketplace_agreements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_agreements_isolation ON marketplace_agreements;
CREATE POLICY marketplace_agreements_isolation ON marketplace_agreements
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_charges TO partneros_app;
ALTER TABLE marketplace_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_charges_isolation ON marketplace_charges;
CREATE POLICY marketplace_charges_isolation ON marketplace_charges
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
