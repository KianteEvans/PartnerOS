import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * DSAR erasure: an owner anonymizes a deactivated member's PII in place. Asserts
 * the scrub + epoch bump, and the guards — active users, self-erasure, and the
 * permission gate (only owner/admin hold user:erase).
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/settings/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let owner = "";
let disabledUser = "";
let activeMember = "";

function identity(userId: string, role: "owner" | "member" = "owner") {
  return {
    tenantId: tenantA,
    userId,
    oidcSubject: `sub-${userId}`,
    epoch: 0,
    email: `${userId}@test`,
    role,
  };
}

function runAs<T>(
  id: ReturnType<typeof identity>,
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "settings.test", resourceType: "user", handler },
    { resolveIdentity: async () => id },
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
    await tx.insert(tenants).values({ id: tenantA, name: "Acme", slug: "acme" });
    const inserted = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" },
        { tenantId: tenantA, oidcSubject: "left-co", email: "former@acme.test", role: "member", status: "disabled" },
        { tenantId: tenantA, oidcSubject: "active-m", email: "active@acme.test", role: "member" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    owner = inserted.find((u) => u.sub === "owner-a")!.id;
    disabledUser = inserted.find((u) => u.sub === "left-co")!.id;
    activeMember = inserted.find((u) => u.sub === "active-m")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("DSAR erasure", () => {
  it("anonymizes a deactivated user's PII and bumps the epoch", async () => {
    await runAs(identity(owner), "user:erase", "erase-1", (ctx) =>
      ops.eraseUserOp(ctx, { userId: disabledUser }),
    );
    const { withSystem } = db.client;
    const { users } = db.schema;
    const [row] = await withSystem((tx) =>
      tx
        .select({ email: users.email, sub: users.oidcSubject, epoch: users.sessionEpoch, status: users.status })
        .from(users)
        .where(eq(users.id, disabledUser)),
    );
    expect(row!.email).toBe(`erased+${disabledUser}@erased.invalid`);
    expect(row!.sub.startsWith("erased:")).toBe(true);
    expect(row!.sub).not.toBe("left-co");
    expect(row!.epoch).toBe(1);
    // The original PII is gone — a login lookup by the old subject/email finds nothing.
    const byOld = await withSystem((tx) =>
      tx.select({ id: users.id }).from(users).where(eq(users.oidcSubject, "left-co")),
    );
    expect(byOld).toHaveLength(0);
  });

  it("refuses to erase an active user", async () => {
    await expect(
      runAs(identity(owner), "user:erase", "erase-active", (ctx) =>
        ops.eraseUserOp(ctx, { userId: activeMember }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("refuses to erase yourself", async () => {
    await expect(
      runAs(identity(owner), "user:erase", "erase-self", (ctx) =>
        ops.eraseUserOp(ctx, { userId: owner }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("is gated to owner/admin (a member is forbidden)", async () => {
    await expect(
      runAs(identity(activeMember, "member"), "user:erase", "erase-perm", (ctx) =>
        ops.eraseUserOp(ctx, { userId: disabledUser }),
      ),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });
});
