import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/env";
import { withSystem } from "@/db/client";
import { users } from "@/db/schema";
import { UnauthorizedError } from "@/http/errors";

/**
 * Session = a signed, httpOnly JWT cookie. Identity is NEVER assertable via a
 * plaintext cookie or header (Rule 3); the only thing a client holds is this
 * signed token, and the server re-derives identity from it on every request
 * (Rule 4). The dev OIDC stub still issues sessions THROUGH this module — it
 * bypasses the external IdP, not the signing.
 */

export const SESSION_COOKIE = "partneros_session";
const ISSUER = "partneros";
const AUDIENCE = "partneros-app";
const MAX_AGE_SECONDS = 60 * 60 * 8; // 8h absolute cap
/** Idle window: a session with no activity for this long is rejected, even if
 *  the 8h token hasn't expired. The client keepalive (SessionKeepalive) slides
 *  `seen` forward while the user is active; the /api/auth/refresh route re-mints. */
export const IDLE_TIMEOUT_SECONDS = 30 * 60; // 30m

const secretKey = new TextEncoder().encode(env.SESSION_JWT_SECRET);

const sessionClaims = z.object({
  tid: z.string().uuid(), // tenantId
  uid: z.string().uuid(), // userId
  sub: z.string().min(1), // oidc subject
  email: z.string().email(),
  role: z.enum(["owner", "admin", "manager", "member", "viewer"]),
  // Session-revocation epoch. Defaults to 0 so tokens issued before this field
  // existed (and the column default) still validate without a forced re-login.
  epoch: z.number().int().nonnegative().default(0),
  // Last-activity epoch (seconds), stamped by signSession + slid by refresh.
  // Optional so pre-existing tokens (no `seen`) aren't force-expired — they pick
  // up idle enforcement on their next refresh.
  seen: z.number().int().nonnegative().optional(),
  // Agency "act-as" context (Bet C). When present, this session is an agency
  // operator acting INSIDE a managed workspace: tid/uid/role are the child
  // workspace's (so the whole app is scoped to it), and `agency` carries the
  // return-to-agency context for the "Exit to portfolio" control. Absent for
  // ordinary sessions. Minted only by the server-side portfolio switch route,
  // which re-verifies the agency->workspace link before signing.
  agency: z
    .object({
      tid: z.string().uuid(),
      uid: z.string().uuid(),
      email: z.string().email(),
      name: z.string(),
    })
    .optional(),
});

export type SessionClaims = z.infer<typeof sessionClaims>;

export interface ActingAsContext {
  readonly agencyTenantId: string;
  readonly agencyUserId: string;
  readonly agencyEmail: string;
  readonly agencyName: string;
}

export interface ServerIdentity {
  readonly tenantId: string;
  readonly userId: string;
  readonly oidcSubject: string;
  readonly email: string;
  readonly role: SessionClaims["role"];
  readonly epoch: number;
  /** Set only when this is an agency operator acting inside a managed workspace. */
  readonly actingAs?: ActingAsContext;
}

function toIdentity(claims: SessionClaims): ServerIdentity {
  return {
    tenantId: claims.tid,
    userId: claims.uid,
    oidcSubject: claims.sub,
    email: claims.email,
    role: claims.role,
    epoch: claims.epoch,
    // Conditional spread keeps the property absent (not `undefined`) for ordinary
    // sessions — required under exactOptionalPropertyTypes.
    ...(claims.agency
      ? {
          actingAs: {
            agencyTenantId: claims.agency.tid,
            agencyUserId: claims.agency.uid,
            agencyEmail: claims.agency.email,
            agencyName: claims.agency.name,
          },
        }
      : {}),
  };
}

/** Mint a signed session JWT, stamping `seen` to now (resets the idle window). */
export async function signSession(claims: SessionClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims, seen: now })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey);
}

/** Verify a token string and return validated identity, or throw. */
export async function verifySession(token: string): Promise<ServerIdentity> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    const parsed = sessionClaims.safeParse(payload);
    if (!parsed.success) throw new UnauthorizedError("Malformed session");
    const claims = parsed.data;
    // Idle timeout — independent of (and shorter than) the 8h token expiry.
    if (
      claims.seen !== undefined &&
      Math.floor(Date.now() / 1000) - claims.seen > IDLE_TIMEOUT_SECONDS
    ) {
      throw new UnauthorizedError("Session timed out due to inactivity");
    }
    return toIdentity(claims);
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError("Invalid or expired session");
  }
}

/** Write the session cookie (server action / route handler context). */
export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: !env.IS_LOCAL_DEV,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/**
 * Verify the session subject is still an active user. A valid JWT alone isn't
 * enough — a deactivated user must lose access immediately, not at token expiry.
 * Wrapped in React `cache()` so it costs one indexed lookup per request even
 * though identity is resolved by the layout, the page, and the mutation gate.
 */
const assertActiveUser = cache(
  async (userId: string, tenantId: string, epoch: number): Promise<void> => {
    const rows = await withSystem((tx) =>
      tx
        .select({ status: users.status, epoch: users.sessionEpoch })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
        .limit(1),
    );
    const row = rows[0];
    if (!row || row.status !== "active") {
      throw new UnauthorizedError("Account is disabled");
    }
    // A bumped session_epoch invalidates every token issued before the bump.
    if (row.epoch !== epoch) {
      throw new UnauthorizedError("Session has been revoked");
    }
  },
);

/**
 * The single source of request identity. Reads the signed cookie, verifies it
 * server-side, and confirms the user is still active and the session hasn't been
 * revoked. Never accept tenant/user/role from request arguments.
 */
export async function getServerIdentity(): Promise<ServerIdentity> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) throw new UnauthorizedError("No session");
  const identity = await verifySession(token);
  await assertActiveUser(identity.userId, identity.tenantId, identity.epoch);
  return identity;
}

/** Non-throwing variant for optional-auth surfaces (e.g. landing pages). */
export async function tryGetServerIdentity(): Promise<ServerIdentity | null> {
  try {
    return await getServerIdentity();
  } catch {
    return null;
  }
}
