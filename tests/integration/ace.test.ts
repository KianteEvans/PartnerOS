import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * ACE Intelligence end-to-end through the gate: opportunity create -> route
 * (assign owner) -> approve (gated, spawns a co-sell task), the owner-tenancy
 * guard, relationship CRUD, and cross-tenant RLS.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/ace/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let memberA = "";

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

let oppId = "";

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
  who = idA,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "ace.test", resourceType: "opportunity", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/ace/operations");

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
        { tenantId: tenantA, oidcSubject: "member-a", email: "member@acme.test", role: "member" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = inserted.find((u) => u.sub === "owner-a")!.id;
    memberA = inserted.find((u) => u.sub === "member-a")!.id;
    ownerB = inserted.find((u) => u.sub === "owner-b")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("ace end-to-end", () => {
  it("creates an opportunity (unrouted)", async () => {
    const res = await run("ace:create", "create", (ctx) =>
      ops.createOpportunityOp(ctx, {
        name: "Acme migration",
        accountName: "Acme",
        stage: "qualified",
        amount: 120_000,
        source: "amazon_originated",
        awsSeller: "Jane (AWS)",
        awsContactId: null,
        closeDate: "2026-09-01",
      }),
    );
    oppId = res.body.id;

    const { withTenant } = db.client;
    const { opportunities } = db.schema;
    const [o] = await withTenant(idA(), (tx) => tx.select().from(opportunities).where(eq(opportunities.id, oppId)));
    expect(o!.routingStatus).toBe("unrouted");
    expect(o!.source).toBe("amazon_originated");
  });

  it("rejects creation by a viewer", async () => {
    await expect(
      run("ace:create", "create-viewer", (ctx) =>
        ops.createOpportunityOp(ctx, { name: "x", accountName: "", stage: "prospect", amount: 0, source: "partner_originated", awsSeller: null, awsContactId: null, closeDate: null }),
        () => identity(tenantA, ownerA, "viewer"),
      ),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("blocks approving routing before an owner is assigned", async () => {
    await expect(
      run("ace:approve", "approve-early", (ctx) => ops.approveRoutingOp(ctx, { id: oppId })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("routes by assigning an owner, and validates owner tenancy", async () => {
    await run("ace:update", "route", (ctx) =>
      ops.updateOpportunityOp(ctx, { id: oppId, ownerUserId: memberA, nextStep: "Book EBC", lastInteraction: "2026-06-20" }),
    );
    const { withTenant } = db.client;
    const { opportunities } = db.schema;
    const [o] = await withTenant(idA(), (tx) => tx.select().from(opportunities).where(eq(opportunities.id, oppId)));
    expect(o!.ownerUserId).toBe(memberA);
    expect(o!.routingStatus).toBe("routed"); // assigning an owner routed it

    await expect(
      run("ace:update", "route-badowner", (ctx) => ops.updateOpportunityOp(ctx, { id: oppId, ownerUserId: ownerB })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("restricts routing approval to manager+ and spawns a co-sell task", async () => {
    // A member cannot approve routing.
    await expect(
      run("ace:approve", "approve-member", (ctx) => ops.approveRoutingOp(ctx, { id: oppId }), () => identity(tenantA, memberA, "member")),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);

    const res = await run("ace:approve", `approve-routing:${oppId}`, (ctx) => ops.approveRoutingOp(ctx, { id: oppId }));
    expect(res.body.taskId).not.toBeNull();

    const { withTenant } = db.client;
    const { opportunities, tasks } = db.schema;
    const [o] = await withTenant(idA(), (tx) => tx.select().from(opportunities).where(eq(opportunities.id, oppId)));
    expect(o!.routingStatus).toBe("approved");
    expect(o!.taskId).toBe(res.body.taskId);

    const aceTasks = await withTenant(idA(), (tx) => tx.select().from(tasks).where(eq(tasks.source, "ace")));
    expect(aceTasks).toHaveLength(1);
    expect(aceTasks[0]!.ownerUserId).toBe(memberA); // owner carried onto the task

    // Re-approving is guarded.
    await expect(
      run("ace:approve", "approve-again", (ctx) => ops.approveRoutingOp(ctx, { id: oppId })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("creates and updates a relationship", async () => {
    const created = await run("ace:create", "rel-create", (ctx) =>
      ops.createRelationshipOp(ctx, { name: "Jane Doe", role: "seller", accountName: "Acme", strength: 40, lastContact: "2026-06-01" }),
    );
    await run("ace:update", "rel-update", (ctx) =>
      ops.updateRelationshipOp(ctx, { id: created.body.id, strength: 85, role: "leadership" }),
    );
    const { withTenant } = db.client;
    const { aceRelationships } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(aceRelationships).where(eq(aceRelationships.id, created.body.id)));
    expect(r!.strength).toBe(85);
    expect(r!.role).toBe("leadership");
  });

  it("links an opportunity to an AWS contact and rejects a cross-tenant contact", async () => {
    const rel = await run("ace:create", "rel-for-link", (ctx) =>
      ops.createRelationshipOp(ctx, { name: "Alex AE", role: "seller", accountName: "Acme", strength: 60, lastContact: "2026-06-10" }),
    );
    const linked = await run("ace:create", "opp-linked", (ctx) =>
      ops.createOpportunityOp(ctx, {
        name: "Linked deal", accountName: "Acme", stage: "qualified", amount: 50_000,
        source: "partner_originated", awsSeller: null, awsContactId: rel.body.id, closeDate: null,
      }),
    );
    const { withTenant, withSystem } = db.client;
    const { opportunities, aceRelationships } = db.schema;
    const [o] = await withTenant(idA(), (tx) => tx.select().from(opportunities).where(eq(opportunities.id, linked.body.id)));
    expect(o!.awsContactId).toBe(rel.body.id);

    // A relationship in tenant B cannot be linked from tenant A.
    const [relB] = await withSystem((tx) =>
      tx.insert(aceRelationships).values({ tenantId: tenantB, name: "B contact", role: "seller", accountName: "x" }).returning({ id: aceRelationships.id }),
    );
    await expect(
      run("ace:create", "opp-crosslink", (ctx) =>
        ops.createOpportunityOp(ctx, {
          name: "Bad", accountName: "Acme", stage: "prospect", amount: 0,
          source: "partner_originated", awsSeller: null, awsContactId: relB!.id, closeDate: null,
        }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("logs a touchpoint and freshens last contact, never regressing it", async () => {
    const rel = await run("ace:create", "rel-for-touch", (ctx) =>
      ops.createRelationshipOp(ctx, { name: "Sam SA", role: "solutions_architect", accountName: "Acme", strength: 50, lastContact: "2026-06-01" }),
    );
    await run("ace:update", "touch-1", (ctx) =>
      ops.logInteractionOp(ctx, { contactId: rel.body.id, opportunityId: null, occurredOn: "2026-06-22", kind: "meeting", note: "QBR prep" }),
    );
    const { withTenant } = db.client;
    const { aceRelationships, aceInteractions } = db.schema;
    const [r1] = await withTenant(idA(), (tx) => tx.select().from(aceRelationships).where(eq(aceRelationships.id, rel.body.id)));
    expect(r1!.lastContact).toBe("2026-06-22"); // bumped forward
    const logged = await withTenant(idA(), (tx) => tx.select().from(aceInteractions).where(eq(aceInteractions.contactId, rel.body.id)));
    expect(logged).toHaveLength(1);
    expect(logged[0]!.kind).toBe("meeting");

    // An older touch must NOT regress last_contact (GREATEST).
    await run("ace:update", "touch-2", (ctx) =>
      ops.logInteractionOp(ctx, { contactId: rel.body.id, opportunityId: null, occurredOn: "2026-05-01", kind: "email", note: "" }),
    );
    const [r2] = await withTenant(idA(), (tx) => tx.select().from(aceRelationships).where(eq(aceRelationships.id, rel.body.id)));
    expect(r2!.lastContact).toBe("2026-06-22"); // unchanged
  });

  // ----- cross-tenant isolation -----

  it("tenant B cannot see tenant A's opportunities", async () => {
    const { withTenant } = db.client;
    const { opportunities } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) => tx.select().from(opportunities));
    expect(seen).toHaveLength(0);
  });

  it("WITH CHECK blocks forging an opportunity into another tenant", async () => {
    const { withTenant } = db.client;
    const { opportunities } = db.schema;
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(opportunities).values({ tenantId: tenantA, name: "forged" }),
      ),
    ).rejects.toThrow();
  });
});
