import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT } from "jose";

/**
 * Server-side enforcement of the idle window. We mint tokens with a chosen `seen`
 * (jose, same secret/issuer/audience as session.ts) and assert verifySession's
 * accept/reject behavior; the refresh route + client keepalive only slide `seen`.
 *
 * session.ts validates `@/env` at import, so we seed the baseline env first and
 * pull the module in via dynamic import (no DB is touched by verify/sign).
 */

let session: typeof import("@/auth/session");
let secret: Uint8Array;

const base = {
  tid: "11111111-1111-1111-1111-111111111111",
  uid: "22222222-2222-2222-2222-222222222222",
  sub: "subject-1",
  email: "user@example.com",
  role: "owner" as const,
  epoch: 0,
};

const now = (): number => Math.floor(Date.now() / 1000);

async function mint(extra: Record<string, unknown>): Promise<string> {
  return new SignJWT({ ...base, ...extra })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer("partneros")
    .setAudience("partneros-app")
    .setExpirationTime("8h")
    .sign(secret);
}

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

  session = await import("@/auth/session");
  secret = new TextEncoder().encode(process.env.SESSION_JWT_SECRET);
});

describe("session idle timeout", () => {
  it("accepts a session seen just now", async () => {
    const id = await session.verifySession(await mint({ seen: now() }));
    expect(id.userId).toBe(base.uid);
  });

  it("accepts a session just inside the idle window", async () => {
    const id = await session.verifySession(
      await mint({ seen: now() - (session.IDLE_TIMEOUT_SECONDS - 60) }),
    );
    expect(id.userId).toBe(base.uid);
  });

  it("rejects a session idle beyond the window", async () => {
    await expect(
      session.verifySession(await mint({ seen: now() - session.IDLE_TIMEOUT_SECONDS - 60 })),
    ).rejects.toThrow(/inactiv/i);
  });

  it("does not idle-expire a legacy token that has no `seen`", async () => {
    const id = await session.verifySession(await mint({}));
    expect(id.userId).toBe(base.uid);
  });

  it("signSession stamps a fresh seen and round-trips through verify", async () => {
    const id = await session.verifySession(await session.signSession(base));
    expect(id.email).toBe(base.email);
    expect(id.role).toBe("owner");
  });
});
