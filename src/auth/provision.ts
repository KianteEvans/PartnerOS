import { and, eq, sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import type { TenantDb } from "@/db/client";
import { tenants, users, invitations } from "@/db/schema";
import type { SessionClaims } from "@/auth/session";
import type { OidcClaims } from "@/auth/oidc";
import { env } from "@/env";
import { UnauthorizedError } from "@/http/errors";

/**
 * Map verified OIDC claims to a PartnerOS session. Runs via the privileged path
 * (withSystem) because no tenant session exists yet — this is the one moment
 * before identity is established (Rule 5). The resolution order:
 *
 *   1. A returning user (matched on the OIDC subject) — disabled accounts are
 *      rejected.
 *   2. A pending INVITATION matching the email — the user joins that tenant with
 *      the invited role and the invite is marked accepted. This is the multi-user
 *      onboarding path and works in production.
 *   3. Otherwise: in production, reject (no account provisioned). Under
 *      PARTNEROS_LOCAL_DEV only, auto-provision a personal owner tenant so the
 *      stack is runnable end-to-end locally.
 */
export async function resolveOrProvisionUser(
  claims: OidcClaims,
): Promise<SessionClaims> {
  return withSystem((tx) => provisionWithinTx(tx, claims, env.IS_LOCAL_DEV));
}

interface UserRow {
  readonly tenantId: string;
  readonly id: string;
  readonly oidcSubject: string;
  readonly email: string;
  readonly role: SessionClaims["role"];
  readonly sessionEpoch: number;
}

function toClaims(u: UserRow): SessionClaims {
  return {
    tid: u.tenantId,
    uid: u.id,
    sub: u.oidcSubject,
    email: u.email,
    role: u.role,
    epoch: u.sessionEpoch,
  };
}

/**
 * The provisioning decision, factored out of `withSystem` so it can be driven
 * against a test database with a real transaction. Assumes it runs with RLS
 * bypassed (the caller owns that). `isLocalDev` is passed in rather than read
 * from env so the branch is deterministically testable.
 */
export async function provisionWithinTx(
  tx: TenantDb,
  claims: OidcClaims,
  isLocalDev: boolean,
): Promise<SessionClaims> {
  // 1. Returning user.
  const found = await tx
    .select()
    .from(users)
    .where(eq(users.oidcSubject, claims.sub))
    .limit(1);
  const existing = found[0];
  if (existing) {
    if (existing.status === "disabled") {
      throw new UnauthorizedError("This account has been disabled");
    }
    return toClaims(existing);
  }

  // 1.5 A SCIM-provisioned user — a real row created by the IdP's directory sync,
  // holding a `scim:` placeholder subject until its owner first authenticates.
  // Matched by email (like invite consumption); the real OIDC subject is bound now.
  const emailLc = claims.email.toLowerCase();
  const scimMatch = await tx
    .select()
    .from(users)
    .where(and(eq(sql`lower(${users.email})`, emailLc), sql`${users.oidcSubject} like 'scim:%'`))
    .orderBy(users.createdAt)
    .limit(1);
  const scimUser = scimMatch[0];
  if (scimUser) {
    if (scimUser.status === "disabled") {
      throw new UnauthorizedError("This account has been disabled");
    }
    const [linked] = await tx
      .update(users)
      .set({ oidcSubject: claims.sub })
      .where(eq(users.id, scimUser.id))
      .returning();
    return toClaims(linked!);
  }

  // 2. Pending invitation for this email → join that tenant with the invited role.
  const email = claims.email.toLowerCase();
  const pending = await tx
    .select()
    .from(invitations)
    .where(and(eq(sql`lower(${invitations.email})`, email), eq(invitations.status, "pending")))
    .orderBy(invitations.createdAt)
    .limit(1);
  const invite = pending[0];
  if (invite) {
    const [user] = await tx
      .insert(users)
      .values({
        tenantId: invite.tenantId,
        oidcSubject: claims.sub,
        email: claims.email,
        role: invite.role,
      })
      .returning();
    await tx
      .update(invitations)
      .set({ status: "accepted", acceptedAt: sql`now()`, acceptedByUserId: user!.id })
      .where(eq(invitations.id, invite.id));
    return toClaims(user!);
  }

  // 3. No account and no invite.
  if (!isLocalDev) {
    throw new UnauthorizedError(
      "No PartnerOS account is provisioned for this identity",
    );
  }

  const slug = `dev-${claims.sub}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 40);

  // Race-safe: a concurrent first-login (e.g. a double-fired OIDC callback) can
  // try to create the SAME dev tenant/user simultaneously. The unique (slug) and
  // (tenant, oidc_subject) indexes would make the loser 500; onConflictDoNothing
  // + re-select lets it resolve the winner's rows instead.
  const insertedTenant = await tx
    .insert(tenants)
    .values({ name: `Dev: ${claims.email}`, slug })
    .onConflictDoNothing({ target: tenants.slug })
    .returning({ id: tenants.id });
  const tenantId =
    insertedTenant[0]?.id ??
    (
      await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1)
    )[0]!.id;

  const insertedUser = await tx
    .insert(users)
    .values({
      tenantId,
      oidcSubject: claims.sub,
      email: claims.email,
      role: "owner",
    })
    .onConflictDoNothing({ target: [users.tenantId, users.oidcSubject] })
    .returning();
  const user =
    insertedUser[0] ??
    (
      await tx
        .select()
        .from(users)
        .where(
          and(eq(users.tenantId, tenantId), eq(users.oidcSubject, claims.sub)),
        )
        .limit(1)
    )[0]!;
  return toClaims(user);
}

/**
 * Provision a SAML identity — TENANT-SCOPED, because the assertion was issued by
 * a specific tenant's IdP. Unlike the OIDC path (which resolves email→invitation
 * across tenants), every lookup here is constrained to `tenantId`, so a shared
 * email can never bind a SAML login to the wrong workspace. The subject is the
 * NameID, already namespaced to the tenant by the caller. No dev auto-provision:
 * a SAML user must be SCIM-provisioned or invited first.
 */
export async function provisionSamlWithinTx(
  tx: TenantDb,
  tenantId: string,
  claims: { readonly sub: string; readonly email: string },
): Promise<SessionClaims> {
  const [returning] = await tx
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.oidcSubject, claims.sub)))
    .limit(1);
  if (returning) {
    if (returning.status === "disabled") throw new UnauthorizedError("This account has been disabled");
    return toClaims(returning);
  }

  const emailLc = claims.email.toLowerCase();

  // SCIM-provisioned member (placeholder subject) → bind the SAML subject.
  const [scimUser] = await tx
    .select()
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(sql`lower(${users.email})`, emailLc),
        sql`${users.oidcSubject} like 'scim:%'`,
      ),
    )
    .limit(1);
  if (scimUser) {
    if (scimUser.status === "disabled") throw new UnauthorizedError("This account has been disabled");
    const [linked] = await tx
      .update(users)
      .set({ oidcSubject: claims.sub })
      .where(eq(users.id, scimUser.id))
      .returning();
    return toClaims(linked!);
  }

  // Pending invitation for this email in this tenant.
  const [invite] = await tx
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, tenantId),
        eq(sql`lower(${invitations.email})`, emailLc),
        eq(invitations.status, "pending"),
      ),
    )
    .limit(1);
  if (invite) {
    const [user] = await tx
      .insert(users)
      .values({ tenantId, oidcSubject: claims.sub, email: claims.email, role: invite.role })
      .returning();
    await tx
      .update(invitations)
      .set({ status: "accepted", acceptedAt: sql`now()`, acceptedByUserId: user!.id })
      .where(eq(invitations.id, invite.id));
    return toClaims(user!);
  }

  throw new UnauthorizedError("No PartnerOS account is provisioned for this identity");
}
