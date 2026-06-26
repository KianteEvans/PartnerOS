import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
// Type-only import is erased at runtime, so it is safe before env is configured.
import type { MutationContext } from "@/gate/mutation-gate";

/**
 * The mutation gate end-to-end against real Postgres (Rule 6): authz, body-size,
 * rate limit, idempotency, and an atomic audit row — plus a cross-tenant check
 * that fails if isolation breaks.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ratelimit: typeof import("@/redis/ratelimit");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
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

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ratelimit = await import("@/redis/ratelimit");

  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const [a] = await tx
      .insert(users)
      .values({
        tenantId: tenantA,
        oidcSubject: "owner-a",
        email: "owner@acme.test",
        role: "owner",
      })
      .returning({ id: users.id });
    const [b] = await tx
      .insert(users)
      .values({
        tenantId: tenantB,
        oidcSubject: "owner-b",
        email: "owner@globex.test",
        role: "owner",
      })
      .returning({ id: users.id });
    ownerA = a!.id;
    ownerB = b!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("mutation gate", () => {
  it("rejects when the role lacks the permission (no handler run)", async () => {
    let ran = false;
    await expect(
      gate.runMutation(
        {
          permission: "user:invite",
          idempotencyKey: "k-forbidden",
          rawBody: "{}",
          action: "user.invite",
          resourceType: "user",
          handler: async () => {
            ran = true;
            return { ok: true };
          },
        },
        { resolveIdentity: async () => identity(tenantA, ownerA, "viewer") },
      ),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
    expect(ran).toBe(false);
  });

  it("runs the handler and writes exactly one audit row", async () => {
    const body = JSON.stringify({ email: "new@acme.test" });
    const res = await gate.runMutation(
      {
        permission: "user:invite",
        idempotencyKey: "k-create-1",
        rawBody: body,
        action: "user.invite",
        resourceType: "user",
        resourceId: (r: { id: string }) => r.id,
        handler: async ({ identity: id, tx }) => {
          const { users } = db.schema;
          const [row] = await tx
            .insert(users)
            .values({
              tenantId: id.tenantId,
              oidcSubject: "invited-1",
              email: "new@acme.test",
              role: "member",
            })
            .returning({ id: users.id });
          return { id: row!.id };
        },
      },
      { resolveIdentity: async () => identity(tenantA, ownerA) },
    );
    expect(res.replayed).toBe(false);
    expect(res.status).toBe(200);

    const { withTenant } = db.client;
    const { auditLog } = db.schema;
    const audits = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx.select().from(auditLog),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("user.invite");
  });

  it("replays a completed response and does NOT re-run the handler", async () => {
    let calls = 0;
    const spec = {
      permission: "user:invite" as const,
      idempotencyKey: "k-replay",
      rawBody: JSON.stringify({ email: "replay@acme.test" }),
      action: "user.invite",
      resourceType: "user",
      handler: async ({ identity: id, tx }: MutationContext) => {
        calls += 1;
        const { users } = db.schema;
        const [row] = await tx
          .insert(users)
          .values({
            tenantId: id.tenantId,
            oidcSubject: "invited-replay",
            email: "replay@acme.test",
            role: "member",
          })
          .returning({ id: users.id });
        return { id: row!.id };
      },
    };
    const deps = { resolveIdentity: async () => identity(tenantA, ownerA) };

    const first = await gate.runMutation(spec, deps);
    const second = await gate.runMutation(spec, deps);

    expect(calls).toBe(1);
    expect(second.replayed).toBe(true);
    expect(second.body).toEqual(first.body);
  });

  it("rejects a reused idempotency key with a different body", async () => {
    const deps = { resolveIdentity: async () => identity(tenantA, ownerA) };
    const base = {
      permission: "user:invite" as const,
      idempotencyKey: "k-conflict",
      action: "user.invite",
      resourceType: "user",
      handler: async () => ({ ok: true }),
    };
    await gate.runMutation({ ...base, rawBody: JSON.stringify({ a: 1 }) }, deps);
    await expect(
      gate.runMutation({ ...base, rawBody: JSON.stringify({ a: 2 }) }, deps),
    ).rejects.toBeInstanceOf(errors.IdempotencyConflictError);
  });

  it("enforces the body-size limit", async () => {
    await expect(
      gate.runMutation(
        {
          permission: "user:invite",
          idempotencyKey: "k-big",
          rawBody: "x".repeat(2000),
          maxBodyBytes: 1000,
          action: "user.invite",
          resourceType: "user",
          handler: async () => ({ ok: true }),
        },
        { resolveIdentity: async () => identity(tenantA, ownerA) },
      ),
    ).rejects.toBeInstanceOf(errors.PayloadTooLargeError);
  });

  it("enforces the rate limit", async () => {
    const limiter = ratelimit.createRateLimiter({ max: 1, windowSeconds: 60 });
    const deps = {
      resolveIdentity: async () => identity(tenantA, ownerA),
      rateLimiter: limiter,
    };
    await gate.runMutation(
      {
        permission: "user:invite",
        idempotencyKey: "k-rl-1",
        rawBody: "{}",
        action: "user.invite",
        resourceType: "user",
        handler: async () => ({ ok: true }),
      },
      deps,
    );
    await expect(
      gate.runMutation(
        {
          permission: "user:invite",
          idempotencyKey: "k-rl-2",
          rawBody: "{}",
          action: "user.invite",
          resourceType: "user",
          handler: async () => ({ ok: true }),
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(errors.RateLimitedError);
  });

  it("audit rows from tenant A are invisible to tenant B", async () => {
    const { withTenant } = db.client;
    const { auditLog } = db.schema;
    const bSees = await withTenant(identity(tenantB, ownerB), (tx) =>
      tx.select().from(auditLog),
    );
    expect(bSees).toHaveLength(0); // A's audit rows must never leak to B
  });
});
