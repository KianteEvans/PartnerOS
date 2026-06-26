import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { env } from "@/env";
import { UnauthorizedError } from "@/http/errors";

/**
 * OIDC identity adapter. A real provider performs the authorization-code flow
 * against a discovered issuer and verifies the id_token signature via JWKS. The
 * dev stub (selected ONLY under PARTNEROS_LOCAL_DEV) is a runnable local
 * implementation — never a production-only mock (Rule 5). Both produce the same
 * verified claims, which are then minted into a signed session by auth/session.
 */

export interface OidcClaims {
  readonly sub: string;
  readonly email: string;
}

export interface OidcProvider {
  /** Build the IdP authorization URL to redirect the user to. */
  authorizationUrl(input: { state: string; nonce: string }): Promise<string>;
  /** Exchange an authorization code for verified identity claims. */
  exchangeCode(input: { code: string; nonce: string }): Promise<OidcClaims>;
}

const discoveryDoc = z.object({
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
  issuer: z.string().min(1),
});

const tokenResponse = z.object({
  id_token: z.string().min(1),
  access_token: z.string().optional(),
});

const idTokenClaims = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  nonce: z.string().optional(),
});

class RealOidcProvider implements OidcProvider {
  private discovery: z.infer<typeof discoveryDoc> | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  private async discover(): Promise<z.infer<typeof discoveryDoc>> {
    if (this.discovery) return this.discovery;
    const url = `${env.OIDC_ISSUER.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new UnauthorizedError(`OIDC discovery failed (${res.status})`);
    }
    const parsed = discoveryDoc.safeParse(await res.json());
    if (!parsed.success) throw new UnauthorizedError("Bad OIDC discovery doc");
    this.discovery = parsed.data;
    this.jwks = createRemoteJWKSet(new URL(parsed.data.jwks_uri));
    return parsed.data;
  }

  async authorizationUrl(input: {
    state: string;
    nonce: string;
  }): Promise<string> {
    const d = await this.discover();
    const u = new URL(d.authorization_endpoint);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", env.OIDC_CLIENT_ID);
    u.searchParams.set("redirect_uri", env.OIDC_REDIRECT_URI);
    u.searchParams.set("scope", "openid email profile");
    u.searchParams.set("state", input.state);
    u.searchParams.set("nonce", input.nonce);
    return u.toString();
  }

  async exchangeCode(input: {
    code: string;
    nonce: string;
  }): Promise<OidcClaims> {
    const d = await this.discover();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: env.OIDC_REDIRECT_URI,
      client_id: env.OIDC_CLIENT_ID,
      client_secret: env.OIDC_CLIENT_SECRET,
    });
    const res = await fetch(d.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new UnauthorizedError("Token exchange failed");
    const token = tokenResponse.parse(await res.json());

    if (!this.jwks) throw new UnauthorizedError("JWKS not initialized");
    const { payload } = await jwtVerify(token.id_token, this.jwks, {
      issuer: d.issuer,
      audience: env.OIDC_CLIENT_ID,
    });
    const claims = idTokenClaims.parse(payload);
    if (claims.nonce !== undefined && claims.nonce !== input.nonce) {
      throw new UnauthorizedError("OIDC nonce mismatch");
    }
    return { sub: claims.sub, email: claims.email };
  }
}

/**
 * Dev stub. Talks to the local OIDC stub server (scripts/stubs/oidc-stub.ts),
 * which speaks just enough of the protocol to be exercised end-to-end. The
 * code returned by that server is a base64url JSON blob of the claims; we still
 * fetch the token endpoint so the same code path is exercised.
 */
class DevStubOidcProvider implements OidcProvider {
  async authorizationUrl(input: {
    state: string;
    nonce: string;
  }): Promise<string> {
    const u = new URL(`${env.OIDC_ISSUER.replace(/\/$/, "")}/authorize`);
    u.searchParams.set("client_id", env.OIDC_CLIENT_ID);
    u.searchParams.set("redirect_uri", env.OIDC_REDIRECT_URI);
    u.searchParams.set("state", input.state);
    u.searchParams.set("nonce", input.nonce);
    return u.toString();
  }

  async exchangeCode(input: {
    code: string;
    nonce: string;
  }): Promise<OidcClaims> {
    const res = await fetch(`${env.OIDC_ISSUER.replace(/\/$/, "")}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: input.code, nonce: input.nonce }),
    });
    if (!res.ok) throw new UnauthorizedError("Stub token exchange failed");
    const claims = idTokenClaims.parse(await res.json());
    return { sub: claims.sub, email: claims.email };
  }
}

let _provider: OidcProvider | null = null;

export function getOidcProvider(): OidcProvider {
  if (_provider) return _provider;
  _provider = env.IS_LOCAL_DEV
    ? new DevStubOidcProvider()
    : new RealOidcProvider();
  return _provider;
}
