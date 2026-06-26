import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Settings & Integrations end-to-end through the gate: workspace settings
 * upsert, role changes with the last-owner guard and manage gating, the
 * connector lifecycle (configure -> sync -> disable), and cross-tenant RLS.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/settings/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let owner2A = "";
let memberA = "";
let ownerB = "";

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
  who = idA,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "settings.test", resourceType: "settings", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/settings/operations");

  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const inserted = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" },
        { tenantId: tenantA, oidcSubject: "owner2-a", email: "owner2@acme.test", role: "owner" },
        { tenantId: tenantA, oidcSubject: "member-a", email: "member@acme.test", role: "member" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = inserted.find((u) => u.sub === "owner-a")!.id;
    owner2A = inserted.find((u) => u.sub === "owner2-a")!.id;
    memberA = inserted.find((u) => u.sub === "member-a")!.id;
    ownerB = inserted.find((u) => u.sub === "owner-b")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("settings end-to-end", () => {
  it("upserts workspace settings", async () => {
    await run("settings:manage", "ws-1", (ctx) =>
      ops.updateWorkspaceSettingsOp(ctx, { displayName: "Acme Partners", automationMode: "auto_with_approval", emailNotifications: false }),
    );
    // Upsert again (same tenant) updates rather than duplicating.
    await run("settings:manage", "ws-2", (ctx) =>
      ops.updateWorkspaceSettingsOp(ctx, { displayName: "Acme Alliances", automationMode: "autonomous", emailNotifications: true }),
    );
    const { withTenant } = db.client;
    const { workspaceSettings } = db.schema;
    const rows = await withTenant(idA(), (tx) => tx.select().from(workspaceSettings).where(eq(workspaceSettings.tenantId, tenantA)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayName).toBe("Acme Alliances");
    expect(rows[0]!.automationMode).toBe("autonomous");
  });

  it("rejects workspace changes by a member", async () => {
    await expect(
      run("settings:manage", "ws-member", (ctx) =>
        ops.updateWorkspaceSettingsOp(ctx, { displayName: "x", automationMode: "off", emailNotifications: true }),
        () => identity(tenantA, memberA, "member")),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("changes a user role and enforces the last-owner guard", async () => {
    await run("user:update", "role-1", (ctx) => ops.updateUserRoleOp(ctx, { userId: memberA, role: "manager" }));
    const { withTenant } = db.client;
    const { users } = db.schema;
    const [m] = await withTenant(idA(), (tx) => tx.select({ role: users.role }).from(users).where(eq(users.id, memberA)));
    expect(m!.role).toBe("manager");

    // Demote one of the two owners -> allowed (another remains).
    await run("user:update", "role-2", (ctx) => ops.updateUserRoleOp(ctx, { userId: owner2A, role: "admin" }));

    // Now only ownerA remains an owner; demoting it is blocked.
    await expect(
      run("user:update", "role-3", (ctx) => ops.updateUserRoleOp(ctx, { userId: ownerA, role: "admin" })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("runs the connector lifecycle: configure -> sync -> disable", async () => {
    await run("settings:manage", "conn-config", (ctx) =>
      ops.configureConnectorOp(ctx, { kind: "ace", endpoint: "https://ace.example", authMode: "oauth" }),
    );
    await run("settings:manage", "conn-sync", (ctx) => ops.syncConnectorOp(ctx, { kind: "ace" }));

    const { withTenant } = db.client;
    const { connectors } = db.schema;
    const [c] = await withTenant(idA(), (tx) => tx.select().from(connectors).where(and(eq(connectors.tenantId, tenantA), eq(connectors.kind, "ace"))));
    expect(c!.status).toBe("configured");
    expect(c!.lastSyncAt).not.toBeNull();

    await run("settings:manage", "conn-disable", (ctx) => ops.setConnectorStatusOp(ctx, { kind: "ace", status: "disabled" }));
    const [c2] = await withTenant(idA(), (tx) => tx.select().from(connectors).where(and(eq(connectors.tenantId, tenantA), eq(connectors.kind, "ace"))));
    expect(c2!.status).toBe("disabled");

    // Syncing an unconfigured connector kind is rejected.
    await expect(
      run("settings:manage", "conn-bad", (ctx) => ops.syncConnectorOp(ctx, { kind: "salesforce" })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  // ----- cross-tenant isolation -----

  it("tenant B cannot see tenant A's settings or connectors", async () => {
    const { withTenant } = db.client;
    const { workspaceSettings, connectors } = db.schema;
    const s = await withTenant(identity(tenantB, ownerB), (tx) => tx.select().from(workspaceSettings));
    const c = await withTenant(identity(tenantB, ownerB), (tx) => tx.select().from(connectors));
    expect(s).toHaveLength(0);
    expect(c).toHaveLength(0);
  });

  it("WITH CHECK blocks forging settings into another tenant", async () => {
    const { withTenant } = db.client;
    const { workspaceSettings } = db.schema;
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(workspaceSettings).values({ tenantId: tenantA, displayName: "forged" }),
      ),
    ).rejects.toThrow();
  });
});

describe("user deactivation", () => {
  it("deactivates then reactivates a member", async () => {
    const { withTenant } = db.client;
    const { users } = db.schema;
    await run("user:update", "status-1", (ctx) => ops.setUserStatusOp(ctx, { userId: memberA, status: "disabled" }));
    let [m] = await withTenant(idA(), (tx) => tx.select({ status: users.status }).from(users).where(eq(users.id, memberA)));
    expect(m!.status).toBe("disabled");

    await run("user:update", "status-2", (ctx) => ops.setUserStatusOp(ctx, { userId: memberA, status: "active" }));
    [m] = await withTenant(idA(), (tx) => tx.select({ status: users.status }).from(users).where(eq(users.id, memberA)));
    expect(m!.status).toBe("active");
  });

  it("refuses self-deactivation", async () => {
    await expect(
      run("user:update", "status-self", (ctx) => ops.setUserStatusOp(ctx, { userId: ownerA, status: "disabled" })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("refuses disabling the last active owner", async () => {
    // owner2A (admin) tries to disable ownerA — the only remaining active owner.
    await expect(
      run(
        "user:update",
        "status-lastowner",
        (ctx) => ops.setUserStatusOp(ctx, { userId: ownerA, status: "disabled" }),
        () => identity(tenantA, owner2A, "admin"),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });
});

describe("session revocation", () => {
  it("bumps the session epoch, invalidating outstanding tokens", async () => {
    const { withTenant } = db.client;
    const { users } = db.schema;
    const [before] = await withTenant(idA(), (tx) =>
      tx.select({ e: users.sessionEpoch }).from(users).where(eq(users.id, memberA)),
    );
    await run("user:update", "revoke-1", (ctx) => ops.revokeUserSessionsOp(ctx, { userId: memberA }));
    const [after] = await withTenant(idA(), (tx) =>
      tx.select({ e: users.sessionEpoch }).from(users).where(eq(users.id, memberA)),
    );
    expect(after!.e).toBe(before!.e + 1);
  });
});
