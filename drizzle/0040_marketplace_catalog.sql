-- AWS Marketplace -- Catalog (listings + pricing dimensions + change sets). AWS is the
-- source of truth: these tables are a synced mirror projection of the Catalog API
-- (ListEntities/DescribeEntity); edits are written through to AWS via StartChangeSet and
-- tracked in marketplace_change_sets. A listing links to a local solution. ASCII.

DO $$ BEGIN
  CREATE TYPE marketplace_product_type AS ENUM (
    'saas', 'ami', 'container', 'machine_learning', 'professional_services'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketplace_visibility AS ENUM ('limited', 'public', 'restricted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketplace_listing_status AS ENUM ('draft', 'published', 'changing', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketplace_dimension_type AS ENUM ('contract', 'usage');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketplace_change_intent AS ENUM (
    'create', 'update_details', 'add_dimension', 'update_dimension',
    'update_visibility', 'publish'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketplace_change_status AS ENUM (
    'preparing', 'applying', 'succeeded', 'failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  entity_id       text NOT NULL,
  product_code    text NOT NULL DEFAULT '',
  title           text NOT NULL,
  product_type    marketplace_product_type NOT NULL DEFAULT 'saas',
  visibility      marketplace_visibility NOT NULL DEFAULT 'limited',
  status          marketplace_listing_status NOT NULL DEFAULT 'draft',
  description      text NOT NULL DEFAULT '',
  solution_id     uuid REFERENCES solutions (id) ON DELETE SET NULL,
  last_synced_at  timestamptz,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listings_entity_idx
  ON marketplace_listings (tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS marketplace_listings_tenant_idx ON marketplace_listings (tenant_id);

CREATE TABLE IF NOT EXISTS marketplace_pricing_dimensions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  listing_id      uuid NOT NULL REFERENCES marketplace_listings (id) ON DELETE CASCADE,
  api_name        text NOT NULL,
  name            text NOT NULL,
  unit            text NOT NULL DEFAULT '',
  -- Price in integer cents (per unit). USD.
  price           integer NOT NULL DEFAULT 0,
  dimension_type  marketplace_dimension_type NOT NULL DEFAULT 'usage',
  restricted      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_dimensions_unique
  ON marketplace_pricing_dimensions (tenant_id, listing_id, api_name);
CREATE INDEX IF NOT EXISTS marketplace_dimensions_listing_idx
  ON marketplace_pricing_dimensions (tenant_id, listing_id);

CREATE TABLE IF NOT EXISTS marketplace_change_sets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  change_set_id   text NOT NULL DEFAULT '',
  listing_id      uuid REFERENCES marketplace_listings (id) ON DELETE CASCADE,
  intent          marketplace_change_intent NOT NULL,
  status          marketplace_change_status NOT NULL DEFAULT 'preparing',
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  error           text NOT NULL DEFAULT '',
  started_at      timestamptz,
  ended_at        timestamptz,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketplace_change_sets_listing_idx
  ON marketplace_change_sets (tenant_id, listing_id);
CREATE INDEX IF NOT EXISTS marketplace_change_sets_tenant_idx
  ON marketplace_change_sets (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_listings TO partneros_app;
ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_listings_isolation ON marketplace_listings;
CREATE POLICY marketplace_listings_isolation ON marketplace_listings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_pricing_dimensions TO partneros_app;
ALTER TABLE marketplace_pricing_dimensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_dimensions_isolation ON marketplace_pricing_dimensions;
CREATE POLICY marketplace_dimensions_isolation ON marketplace_pricing_dimensions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_change_sets TO partneros_app;
ALTER TABLE marketplace_change_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_change_sets_isolation ON marketplace_change_sets;
CREATE POLICY marketplace_change_sets_isolation ON marketplace_change_sets
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
