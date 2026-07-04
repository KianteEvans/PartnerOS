-- AWS Marketplace -- Metering (resolved customers + usage records). Partner-originated:
-- usage is submitted to AWS via BatchMeterUsage/MeterUsage and the per-record accepted/
-- rejected result is stored. ResolveCustomer maps a registration token to a customer +
-- product code. ASCII.

DO $$ BEGIN
  CREATE TYPE marketplace_metering_status AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS marketplace_customers (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  customer_identifier     text NOT NULL,
  customer_aws_account_id text NOT NULL DEFAULT '',
  product_code            text NOT NULL DEFAULT '',
  listing_id              uuid REFERENCES marketplace_listings (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_customers_unique
  ON marketplace_customers (tenant_id, customer_identifier);
CREATE INDEX IF NOT EXISTS marketplace_customers_tenant_idx ON marketplace_customers (tenant_id);

CREATE TABLE IF NOT EXISTS marketplace_metering_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  listing_id          uuid NOT NULL REFERENCES marketplace_listings (id) ON DELETE CASCADE,
  dimension           text NOT NULL,
  customer_identifier text NOT NULL DEFAULT '',
  quantity            integer NOT NULL DEFAULT 0,
  usage_timestamp     timestamptz NOT NULL DEFAULT now(),
  status              marketplace_metering_status NOT NULL DEFAULT 'pending',
  metering_record_id  text NOT NULL DEFAULT '',
  result              text NOT NULL DEFAULT '',
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketplace_metering_listing_idx
  ON marketplace_metering_records (tenant_id, listing_id);
CREATE INDEX IF NOT EXISTS marketplace_metering_tenant_idx
  ON marketplace_metering_records (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_customers TO partneros_app;
ALTER TABLE marketplace_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_customers_isolation ON marketplace_customers;
CREATE POLICY marketplace_customers_isolation ON marketplace_customers
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_metering_records TO partneros_app;
ALTER TABLE marketplace_metering_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_metering_isolation ON marketplace_metering_records;
CREATE POLICY marketplace_metering_isolation ON marketplace_metering_records
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
