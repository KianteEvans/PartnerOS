-- ============================================================================
-- SAML 2.0 SSO config — extends sso_config (alongside the SCIM fields). Per
-- tenant: the IdP's entityID, its SSO redirect endpoint, and its X.509 signing
-- certificate (PEM body). The SP validates every assertion's signature against
-- this cert (xml-crypto), so it is the trust anchor. No secrets here — the cert
-- is public — so these are admin-editable under normal RLS.
-- ============================================================================

ALTER TABLE sso_config ADD COLUMN IF NOT EXISTS saml_enabled       boolean NOT NULL DEFAULT false;
ALTER TABLE sso_config ADD COLUMN IF NOT EXISTS saml_idp_entity_id text;
ALTER TABLE sso_config ADD COLUMN IF NOT EXISTS saml_idp_sso_url    text;
ALTER TABLE sso_config ADD COLUMN IF NOT EXISTS saml_idp_cert       text;
