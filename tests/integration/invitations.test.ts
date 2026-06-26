import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Invitations end-to-end: create/revoke through the gate, then the consumption
 * path — a new OIDC identity whose email matches a pending invite joins that
 * tenant with the invited role (provisionWithinTx), plus the production-reject
 * and local-dev auto-provision branches.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/settings/operations");
let provision: typeof import("@/auth/provision");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let ownerA = "";

function identity(tenantId: string, userId: string, role = "owner") {
  return {
    tenantId,
    userId,
    oidcSubject: `sub-${userId}`,
    epoch: 0,
    email: `${userId}@test`,
    role: role as "owner" | "admin" | "manager" | "member" | "viewer",
  };
}
const idA = () => identity(tenantA, ownerA);

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "settings.test", resourceType: "invitation", handler },
    { resolveIdentity: async () => idA() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/settings/operations");
  provision = await import("@/auth/provision");

  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values({ id: tenantA, name: "Acme", slug: "acme" });
    const [u] = await tx
      .insert(users)
      .values({ tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" })
      .returning({ id: users.id });
    ownerA = u!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("invitations", () => {
  it("creates a pending invitation (email normalized)", async () => {
    await run("user:update", "inv-1", (ctx) => ops.inviteUserOp(ctx, { email: "New@Acme.test", role: "manager" }));
    const { withTenant } = db.client;
    const { invitations } = db.schema;
    const rows = await withTenant(idA(), (tx) =>
      tx.select().from(invitations).where(eq(invitations.tenantId, tenantA)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe("new@acme.test");
    expect(rows[0]!.role).toBe("manager");
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.token).toBeTruthy();
  });

  it("rejects inviting an existing active member", async () => {
    await expect(
      run("user:update", "inv-member", (ctx) => ops.inviteUserOp(ctx, { email: "owner@acme.test", role: "member" })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("re-inviting the same email updates the role, not a duplicate", async () => {
    await run("user:update", "inv-2", (ctx) => ops.inviteUserOp(ctx, { email: "new@acme.test", role: "admin" }));
    const { withTenant } = db.client;
    const { invitations } = db.schema;
    const rows = await withTenant(idA(), (tx) =>
      tx.select().from(invitations).where(and(eq(invitations.tenantId, tenantA), eq(invitations.status, "pending"))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe("admin");
  });

  it("consumes the invite at first login (email match, case-insensitive)", async () => {
    const { withSystem, withTenant } = db.client;
    const { users, invitations } = db.schema;
    const claims = await withSystem((tx) =>
      provision.provisionWithinTx(tx, { sub: "new-subject", email: "NEW@acme.test" }, false),
    );
    expect(claims.tid).toBe(tenantA);
    expect(claims.role).toBe("admin");

    const [u] = await withTenant(idA(), (tx) =>
      tx.select({ role: users.role }).from(users).where(eq(users.oidcSubject, "new-subject")),
    );
    expect(u!.role).toBe("admin");

    const [inv] = await withTenant(idA(), (tx) =>
      tx.select({ status: invitations.status }).from(invitations).where(eq(invitations.tenantId, tenantA)),
    );
    expect(inv!.status).toBe("accepted");
  });

  it("rejects an unknown identity in production (no invite)", async () => {
    const { withSystem } = db.client;
    await expect(
      withSystem((tx) =>
        provision.provisionWithinTx(tx, { sub: "stranger", email: "stranger@nowhere.test" }, false),
      ),
    ).rejects.toBeInstanceOf(errors.UnauthorizedError);
  });

  it("auto-provisions a personal owner tenant under local dev", async () => {
    const { withSystem } = db.client;
    const claims = await withSystem((tx) =>
      provision.provisionWithinTx(tx, { sub: "dev-guy", email: "dev@elsewhere.test" }, true),
    );
    expect(claims.role).toBe("owner");
    expect(claims.tid).not.toBe(tenantA);
  });

  it("dev re-login is idempotent (reuses the same tenant + user, no duplicate)", async () => {
    const { withSystem } = db.client;
    const { users } = db.schema;
    const claims = { sub: "dev-again", email: "again@dev.test" };
    const first = await withSystem((tx) => provision.provisionWithinTx(tx, claims, true));
    const second = await withSystem((tx) => provision.provisionWithinTx(tx, claims, true));
    expect(second.uid).toBe(first.uid);
    expect(second.tid).toBe(first.tid);
    const us = await withSystem((tx) =>
      tx.select().from(users).where(eq(users.oidcSubject, "dev-again")),
    );
    expect(us).toHaveLength(1);
  });

  it("dev auto-provision tolerates a pre-existing tenant slug (race-safe, no crash)", async () => {
    const { withSystem } = db.client;
    const { tenants, users } = db.schema;
    const sub = "dev-race";
    const slug = `dev-${sub}`;
    // Simulate the winner of a concurrent first-login: the dev tenant already exists.
    await withSystem((tx) =>
      tx.insert(tenants).values({ name: "Dev: race@dev.test", slug }),
    );
    const claims = await withSystem((tx) =>
      provision.provisionWithinTx(tx, { sub, email: "race@dev.test" }, true),
    );
    const [t] = await withSystem((tx) =>
      tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)),
    );
    expect(claims.tid).toBe(t!.id); // resolved onto the existing tenant, not a 500
    const us = await withSystem((tx) =>
      tx.select().from(users).where(eq(users.oidcSubject, sub)),
    );
    expect(us).toHaveLength(1);
    expect(us[0]!.tenantId).toBe(t!.id);
  });

  it("revokes a pending invitation", async () => {
    await run("user:update", "inv-revoke-setup", (ctx) => ops.inviteUserOp(ctx, { email: "temp@acme.test", role: "viewer" }));
    const { withTenant } = db.client;
    const { invitations } = db.schema;
    const [pending] = await withTenant(idA(), (tx) =>
      tx.select({ id: invitations.id }).from(invitations).where(and(eq(invitations.email, "temp@acme.test"), eq(invitations.status, "pending"))),
    );
    await run("user:update", "inv-revoke", (ctx) => ops.revokeInvitationOp(ctx, { invitationId: pending!.id }));
    const [after] = await withTenant(idA(), (tx) =>
      tx.select({ status: invitations.status }).from(invitations).where(eq(invitations.id, pending!.id)),
    );
    expect(after!.status).toBe("revoked");

    // Revoking again (no longer pending) is rejected.
    await expect(
      run("user:update", "inv-revoke-2", (ctx) => ops.revokeInvitationOp(ctx, { invitationId: pending!.id })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("rejects a disabled returning user at login", async () => {
    const { withSystem } = db.client;
    const { users } = db.schema;
    await withSystem((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, ownerA)));
    await expect(
      withSystem((tx) =>
        provision.provisionWithinTx(tx, { sub: "owner-a", email: "owner@acme.test" }, false),
      ),
    ).rejects.toBeInstanceOf(errors.UnauthorizedError);
  });
});
