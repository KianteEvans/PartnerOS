import { describe, it, expect, beforeAll } from "vitest";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";

/**
 * The security crux of SAML: does the SP accept a correctly-signed assertion and
 * REJECT one signed by the wrong key / not signed at all? We mint a throwaway IdP
 * keypair, hand-build a SAML Response, sign its Assertion with xml-crypto, and run
 * it through node-saml configured with the matching (and a mismatching) cert.
 */

let sp: typeof import("@/domain/saml/sp");
let idp: { privateKey: string; certBody: string };
let other: { certBody: string };

const ORIGIN = "https://app.partneros.test";
const SLUG = "acme";
const cfg = () => ({ tenantId: "11111111-1111-1111-1111-111111111111", slug: SLUG, idpSsoUrl: "https://idp.test/sso", idpCert: idp.certBody });

/** A real self-signed X.509 cert + its private key (what node-saml expects). */
function keypair(): { privateKey: string; certBody: string } {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [{ name: "commonName", value: "test-idp" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certBody = forge.pki
    .certificateToPem(cert)
    .replace(/-----[A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  return { privateKey: forge.pki.privateKeyToPem(keys.privateKey), certBody };
}

function buildResponse(email: string): string {
  const now = new Date();
  const iso = (d: Date) => d.toISOString();
  const plus = (m: number) => iso(new Date(now.getTime() + m * 60000));
  const minus = (m: number) => iso(new Date(now.getTime() - m * 60000));
  const acs = `${ORIGIN}/api/auth/saml/${SLUG}/acs`;
  const audience = `${ORIGIN}/api/auth/saml/${SLUG}/metadata`;
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp1" Version="2.0" IssueInstant="${iso(now)}" Destination="${acs}"><saml:Issuer>https://idp.test/entity</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_assert1" Version="2.0" IssueInstant="${iso(now)}"><saml:Issuer>https://idp.test/entity</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${plus(5)}" Recipient="${acs}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${minus(5)}" NotOnOrAfter="${plus(5)}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="_sess1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion></samlp:Response>`;
}

function signAssertion(xml: string, privateKey: string): string {
  const sig = new SignedXml({ privateKey });
  sig.signatureAlgorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
  sig.canonicalizationAlgorithm = "http://www.w3.org/2001/10/xml-exc-c14n#";
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: "after" },
  });
  return sig.getSignedXml();
}

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

beforeAll(async () => {
  (process.env as Record<string, string>).NODE_ENV = "test";
  process.env.PARTNEROS_LOCAL_DEV ??= "true";
  process.env.PARTNEROS_DEPLOY_ENV ??= "";
  process.env.DATABASE_URL ??= "postgres://u:p@localhost:5432/x";
  process.env.DATABASE_MIGRATOR_URL ??= "postgres://u:p@localhost:5432/x";
  process.env.OIDC_ISSUER ??= "http://localhost:4444";
  process.env.OIDC_CLIENT_ID ??= "partneros-local";
  process.env.OIDC_CLIENT_SECRET ??= "local-stub-secret";
  process.env.OIDC_REDIRECT_URI ??= "http://localhost:3000/api/auth/callback";
  process.env.SESSION_JWT_SECRET ??= "test-only-secret-at-least-32-bytes-long-xx";
  process.env.S3_ENDPOINT ??= "http://localhost:9000";
  process.env.S3_REGION ??= "us-east-1";
  process.env.S3_BUCKET ??= "partneros-evidence";
  process.env.S3_ACCESS_KEY_ID ??= "local-stub";
  process.env.S3_SECRET_ACCESS_KEY ??= "local-stub-secret";
  process.env.MALWARE_SCAN_WEBHOOK_SECRET ??= "test-scan-hmac-secret";

  sp = await import("@/domain/saml/sp");
  idp = keypair();
  other = { certBody: keypair().certBody };
});

describe("samlEmail", () => {
  it("prefers the email attribute, falls back to an email-shaped NameID", async () => {
    expect(sp.samlEmail({ nameID: "x", email: "A@B.co" } as never)).toBe("a@b.co");
    expect(sp.samlEmail({ nameID: "jo@acme.test" } as never)).toBe("jo@acme.test");
    expect(sp.samlEmail({ nameID: "opaque-id" } as never)).toBeNull();
  });
});

describe("SP-initiated login", () => {
  it("redirects to the IdP with a SAMLRequest", async () => {
    const url = await sp.buildSaml(cfg(), ORIGIN).getAuthorizeUrlAsync("/", undefined, {});
    expect(url.startsWith("https://idp.test/sso")).toBe(true);
    expect(url).toContain("SAMLRequest=");
  });
});

describe("ACS assertion validation", () => {
  it("accepts an assertion signed by the configured IdP key", async () => {
    const signed = signAssertion(buildResponse("jo@acme.test"), idp.privateKey);
    const { profile } = await sp.buildSaml(cfg(), ORIGIN).validatePostResponseAsync({ SAMLResponse: b64(signed) });
    expect(profile?.nameID).toBe("jo@acme.test");
    expect(sp.samlEmail(profile!)).toBe("jo@acme.test");
  });

  it("rejects an assertion signed by a different key", async () => {
    const signed = signAssertion(buildResponse("jo@acme.test"), idp.privateKey);
    const wrongCfg = { ...cfg(), idpCert: other.certBody };
    await expect(
      sp.buildSaml(wrongCfg, ORIGIN).validatePostResponseAsync({ SAMLResponse: b64(signed) }),
    ).rejects.toBeTruthy();
  });

  it("rejects an unsigned assertion", async () => {
    const unsigned = buildResponse("jo@acme.test");
    await expect(
      sp.buildSaml(cfg(), ORIGIN).validatePostResponseAsync({ SAMLResponse: b64(unsigned) }),
    ).rejects.toBeTruthy();
  });
});
