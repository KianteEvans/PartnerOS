import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { workspaceSettings, connectors, users, invitations } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import type { AutomationMode } from "@/domain/settings/automation";
import type { ConnectorKind } from "@/domain/settings/connectors";

/**
 * The database side of Settings & Integrations. Factored out of the actions so
 * the gate drives them in tests. Workspace settings and connectors upsert on
 * their unique keys; role changes guard the last-owner invariant.
 */

type Role = "owner" | "admin" | "manager" | "member" | "viewer";

export async function updateWorkspaceSettingsOp(
  { identity, tx }: MutationContext,
  input: {
    readonly displayName: string;
    readonly automationMode: AutomationMode;
    readonly emailNotifications: boolean;
  },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(workspaceSettings)
    .values({
      tenantId: identity.tenantId,
      displayName: input.displayName,
      automationMode: input.automationMode,
      emailNotifications: input.emailNotifications,
      createdBy: identity.userId,
    })
    .onConflictDoUpdate({
      target: workspaceSettings.tenantId,
      set: {
        displayName: input.displayName,
        automationMode: input.automationMode,
        emailNotifications: input.emailNotifications,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: workspaceSettings.id });
  return { id: row!.id };
}

/**
 * Change a user's role. A tenant must always retain at least one owner, so the
 * last owner cannot be demoted.
 */
export async function updateUserRoleOp(
  { identity, tx }: MutationContext,
  change: { readonly userId: string; readonly role: Role },
): Promise<{ id: string }> {
  const [target] = await tx
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, change.userId), eq(users.tenantId, identity.tenantId)));
  if (!target) throw new ValidationError("User not found in this workspace");

  if (target.role === "owner" && change.role !== "owner") {
    const owners = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, identity.tenantId), eq(users.role, "owner")));
    if (owners.length <= 1) {
      throw new ValidationError("Cannot remove the last owner of the workspace");
    }
  }

  await tx
    .update(users)
    .set({ role: change.role })
    .where(and(eq(users.id, change.userId), eq(users.tenantId, identity.tenantId)));
  return { id: change.userId };
}

/**
 * Activate or deactivate a member. Deactivating preserves the row (and its audit
 * trail) but locks the account out everywhere (login + every request). Guards:
 * you can't disable yourself, and a tenant must keep at least one active owner.
 */
export async function setUserStatusOp(
  { identity, tx }: MutationContext,
  change: { readonly userId: string; readonly status: "active" | "disabled" },
): Promise<{ id: string }> {
  if (change.status === "disabled" && change.userId === identity.userId) {
    throw new ValidationError("You cannot disable your own account");
  }

  const [target] = await tx
    .select({ role: users.role, status: users.status })
    .from(users)
    .where(and(eq(users.id, change.userId), eq(users.tenantId, identity.tenantId)));
  if (!target) throw new ValidationError("User not found in this workspace");

  if (change.status === "disabled" && target.role === "owner" && target.status === "active") {
    const activeOwners = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.tenantId, identity.tenantId),
          eq(users.role, "owner"),
          eq(users.status, "active"),
        ),
      );
    if (activeOwners.length <= 1) {
      throw new ValidationError("Cannot disable the last active owner of the workspace");
    }
  }

  await tx
    .update(users)
    .set({ status: change.status })
    .where(and(eq(users.id, change.userId), eq(users.tenantId, identity.tenantId)));
  return { id: change.userId };
}

/**
 * Invite a teammate by email + role. Rejects an email that's already an active
 * member; re-inviting an email with a still-pending invite updates its role.
 * The invite is consumed at the invitee's first OIDC login (see provision.ts).
 */
export async function inviteUserOp(
  { identity, tx }: MutationContext,
  payload: { readonly email: string; readonly role: Role },
): Promise<{ id: string }> {
  const email = payload.email.toLowerCase();

  const [member] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenantId, identity.tenantId),
        sql`lower(${users.email}) = ${email}`,
        eq(users.status, "active"),
      ),
    );
  if (member) throw new ValidationError("That email is already an active member");

  const [pendingExisting] = await tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, identity.tenantId),
        sql`lower(${invitations.email}) = ${email}`,
        eq(invitations.status, "pending"),
      ),
    );
  if (pendingExisting) {
    await tx.update(invitations).set({ role: payload.role }).where(eq(invitations.id, pendingExisting.id));
    return { id: pendingExisting.id };
  }

  const [row] = await tx
    .insert(invitations)
    .values({
      tenantId: identity.tenantId,
      email,
      role: payload.role,
      token: randomUUID(),
      invitedByUserId: identity.userId,
    })
    .returning({ id: invitations.id });
  return { id: row!.id };
}

/** Revoke a still-pending invitation. */
export async function revokeInvitationOp(
  { identity, tx }: MutationContext,
  input: { readonly invitationId: string },
): Promise<{ id: string }> {
  const updated = await tx
    .update(invitations)
    .set({ status: "revoked" })
    .where(
      and(
        eq(invitations.id, input.invitationId),
        eq(invitations.tenantId, identity.tenantId),
        eq(invitations.status, "pending"),
      ),
    )
    .returning({ id: invitations.id });
  if (updated.length === 0) {
    throw new ValidationError("Invitation not found or already handled");
  }
  return { id: updated[0]!.id };
}

/**
 * Revoke a user's sessions by bumping their session epoch. Every outstanding
 * token (issued with the old epoch) fails the per-request check on its next use,
 * forcing a fresh login — without disabling the account. Used for offboarding,
 * suspected compromise, or "sign out of all devices".
 */
export async function revokeUserSessionsOp(
  { identity, tx }: MutationContext,
  change: { readonly userId: string },
): Promise<{ id: string }> {
  const updated = await tx
    .update(users)
    .set({ sessionEpoch: sql`${users.sessionEpoch} + 1` })
    .where(and(eq(users.id, change.userId), eq(users.tenantId, identity.tenantId)))
    .returning({ id: users.id });
  if (updated.length === 0) throw new ValidationError("User not found in this workspace");
  return { id: change.userId };
}

/**
 * DSAR erasure (right to be forgotten). Anonymizes the identifying PII (email +
 * OIDC subject) of an ALREADY-DEACTIVATED member IN PLACE, rather than deleting
 * the row — that preserves referential integrity for the immutable audit trail
 * and work-product attribution while making the person unidentifiable and
 * un-relinkable. The session epoch is bumped so any lingering token is dead.
 *
 * Guards: irreversible, so the account must be deactivated first (a deliberate
 * two-step offboarding), and you can never erase yourself.
 */
export async function eraseUserOp(
  { identity, tx }: MutationContext,
  payload: { readonly userId: string },
): Promise<{ id: string }> {
  if (payload.userId === identity.userId) {
    throw new ValidationError("You cannot erase your own account");
  }
  const [target] = await tx
    .select({ status: users.status })
    .from(users)
    .where(and(eq(users.id, payload.userId), eq(users.tenantId, identity.tenantId)));
  if (!target) throw new ValidationError("User not found in this workspace");
  if (target.status !== "disabled") {
    throw new ValidationError("Deactivate the user before erasing their data");
  }

  // Both fields carry a per-tenant unique index; the userId/randomUUID suffixes
  // guarantee no collision with another (possibly already-erased) row.
  await tx
    .update(users)
    .set({
      email: `erased+${payload.userId}@erased.invalid`,
      oidcSubject: `erased:${randomUUID()}`,
      sessionEpoch: sql`${users.sessionEpoch} + 1`,
    })
    .where(and(eq(users.id, payload.userId), eq(users.tenantId, identity.tenantId)));
  return { id: payload.userId };
}

export async function configureConnectorOp(
  { identity, tx }: MutationContext,
  input: { readonly kind: ConnectorKind; readonly endpoint: string; readonly authMode: string },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(connectors)
    .values({
      tenantId: identity.tenantId,
      kind: input.kind,
      status: "configured",
      endpoint: input.endpoint,
      authMode: input.authMode,
      createdBy: identity.userId,
    })
    .onConflictDoUpdate({
      target: [connectors.tenantId, connectors.kind],
      set: {
        status: "configured",
        endpoint: input.endpoint,
        authMode: input.authMode,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: connectors.id });
  return { id: row!.id };
}

export async function setConnectorStatusOp(
  { identity, tx }: MutationContext,
  input: { readonly kind: ConnectorKind; readonly status: "configured" | "disabled" },
): Promise<{ id: string }> {
  const updated = await tx
    .update(connectors)
    .set({ status: input.status, updatedAt: sql`now()` })
    .where(and(eq(connectors.tenantId, identity.tenantId), eq(connectors.kind, input.kind)))
    .returning({ id: connectors.id });
  if (updated.length === 0) throw new ValidationError("Configure the connector first");
  return { id: updated[0]!.id };
}

/** Simulate a connection test / sync: stamp last_sync_at and clear any error. */
export async function syncConnectorOp(
  { identity, tx }: MutationContext,
  input: { readonly kind: ConnectorKind },
): Promise<{ id: string }> {
  const updated = await tx
    .update(connectors)
    .set({ status: "configured", lastSyncAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(connectors.tenantId, identity.tenantId), eq(connectors.kind, input.kind)))
    .returning({ id: connectors.id });
  if (updated.length === 0) throw new ValidationError("Configure the connector first");
  return { id: updated[0]!.id };
}
