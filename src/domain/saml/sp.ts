import { SAML, ValidateInResponseTo, type Profile } from "@node-saml/node-saml";
import { eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { tenants, ssoConfig } from "@/db/schema";

/**
 * Per-tenant SAML 2.0 Service Provider. Each tenant has its own IdP, addressed by
 * slug at /api/auth/saml/<slug>/{login,acs,metadata}. The IdP's X.509 cert is the
 * trust anchor — node-saml (xml-crypto) validates every assertion's signature
 * against it. We accept a signed ASSERTION (wantAssertionsSigned) rather than
 * requiring the whole response be signed, which most IdPs do.
 */

export interface SamlTenant {
  readonly tenantId: string;
  readonly slug: string;
  readonly idpSsoUrl: string;
  readonly idpCert: string;
}

/** Load a tenant's SAML config by slug; null unless SAML is enabled + complete. */
export async function loadSamlTenant(slug: string): Promise<SamlTenant | null> {
  const rows = await withSystem((tx) =>
    tx
      .select({
        tenantId: tenants.id,
        slug: tenants.slug,
        enabled: ssoConfig.samlEnabled,
        idpSsoUrl: ssoConfig.samlIdpSsoUrl,
        idpCert: ssoConfig.samlIdpCert,
      })
      .from(tenants)
      .innerJoin(ssoConfig, eq(ssoConfig.tenantId, tenants.id))
      .where(eq(tenants.slug, slug))
      .limit(1),
  );
  const r = rows[0];
  if (!r || !r.enabled || !r.idpSsoUrl || !r.idpCert) return null;
  return { tenantId: r.tenantId, slug: r.slug, idpSsoUrl: r.idpSsoUrl, idpCert: r.idpCert };
}

export function samlBase(origin: string, slug: string): string {
  return `${origin}/api/auth/saml/${slug}`;
}

/** The SP entityID we advertise (and validate `Audience` against). */
export function spEntityId(origin: string, slug: string): string {
  return `${samlBase(origin, slug)}/metadata`;
}

export function buildSaml(cfg: SamlTenant, origin: string): SAML {
  const base = samlBase(origin, cfg.slug);
  return new SAML({
    callbackUrl: `${base}/acs`,
    entryPoint: cfg.idpSsoUrl,
    issuer: `${base}/metadata`,
    audience: `${base}/metadata`,
    idpCert: cfg.idpCert,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    // Stateless SP (serverless): we don't persist outstanding request ids, so we
    // don't correlate InResponseTo. RelayState carries the return slug instead.
    validateInResponseTo: ValidateInResponseTo.never,
    disableRequestedAuthnContext: true,
    identifierFormat: null,
    acceptedClockSkewMs: 5000,
  });
}

/** Best-effort email from a validated SAML profile (attribute, oid, or NameID). */
export function samlEmail(profile: Profile): string | null {
  const candidates = [
    profile.email,
    profile.mail,
    profile["urn:oid:0.9.2342.19200300.100.1.3"],
    profile.nameID,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.includes("@")) return c.trim().toLowerCase();
  }
  return null;
}
