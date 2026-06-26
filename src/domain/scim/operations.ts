import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { users, ssoConfig } from "@/db/schema";

/**
 * SCIM provisioning operations. The IdP isn't a logged-in user, so these run
 * privileged (withSystem) and EXPLICITLY scope every query to the tenant the
 * bearer token resolved to — that scoping is the isolation boundary, so it must
 * never be omitted. SCIM Users are real `users` rows; a `scim:` placeholder
 * subject is swapped for the real OIDC subject at first login (provision.ts).
 */

export interface ScimUser {
  readonly id: string;
  readonly email: string;
  readonly status: "active" | "disabled";
  readonly createdAt: Date;
}

const COLS = {
  id: users.id,
  email: users.email,
  status: users.status,
  createdAt: users.createdAt,
} as const;

export function hashScimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolve a bearer token to its tenant id, or null if unknown / SCIM disabled. */
export async function resolveScimTenant(token: string): Promise<string | null> {
  const hash = hashScimToken(token);
  const rows = await withSystem((tx) =>
    tx
      .select({ tenantId: ssoConfig.tenantId, enabled: ssoConfig.scimEnabled })
      .from(ssoConfig)
      .where(eq(ssoConfig.scimTokenHash, hash))
      .limit(1),
  );
  const row = rows[0];
  if (!row || !row.enabled) return null;
  return row.tenantId;
}

/** Provision (or return existing) a user by email. `created` drives 201 vs 200. */
export async function scimCreateUser(
  tenantId: string,
  input: { email: string; active: boolean },
): Promise<{ user: ScimUser; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  return withSystem(async (tx) => {
    const [existing] = await tx
      .select(COLS)
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(sql`lower(${users.email})`, email)));
    if (existing) return { user: existing, created: false };

    const [created] = await tx
      .insert(users)
      .values({
        tenantId,
        oidcSubject: `scim:${randomUUID()}`,
        email,
        role: "member",
        status: input.active ? "active" : "disabled",
      })
      .returning(COLS);
    return { user: created!, created: true };
  });
}

/** List users in the tenant, optionally filtered to one email (existence check). */
export async function scimListUsers(
  tenantId: string,
  emailFilter: string | null,
): Promise<ScimUser[]> {
  return withSystem((tx) => {
    const where = emailFilter
      ? and(eq(users.tenantId, tenantId), eq(sql`lower(${users.email})`, emailFilter))
      : eq(users.tenantId, tenantId);
    return tx.select(COLS).from(users).where(where).orderBy(asc(users.createdAt));
  });
}

export async function scimGetUser(tenantId: string, userId: string): Promise<ScimUser | null> {
  const rows = await withSystem((tx) =>
    tx.select(COLS).from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

/** (De)activate a user — the SCIM PATCH deprovision path. Disabling revokes sessions. */
export async function scimSetActive(
  tenantId: string,
  userId: string,
  active: boolean,
): Promise<ScimUser | null> {
  return withSystem(async (tx) => {
    const updated = await tx
      .update(users)
      .set(
        active
          ? { status: "active" }
          : { status: "disabled", sessionEpoch: sql`${users.sessionEpoch} + 1` },
      )
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .returning(COLS);
    return updated[0] ?? null;
  });
}
