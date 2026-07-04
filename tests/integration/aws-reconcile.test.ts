import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * "Accept AWS as truth" reconciliation write-back. Verifies the correlated
 * UPDATE ... FROM copies mirror values onto the local opportunity (1:1 fields),
 * refuses an empty selection, leaves manual opps (null external id) alone, and — the
 * load-bearing safety property — cannot be used cross-tenant even with a valid id.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let aws: typeof import("@/domain/aws/operations");

const tenantA = "a1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "b1b1b1b1-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let driftOppA = ""; // A: AWS-linked (PC-1), drifted vs mirror
let manualOppA = ""; // A: manual (external id null)

function identity(tenantId: string, userId: string) {
  return { tenantId, userId, oidcSubject: `sub-${userId}`, epoch: 0, email: `${userId}@t`, role: "owner" as const };
}
function runAs<T>(
  id: ReturnType<typeof identity>,
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "aws.test", resourceType: "opportunity", handler },
    { resolveIdentity: async () => id },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  aws = await import("@/domain/aws/operations");

  const { withSystem } = db.client;
  const { tenants, users, opportunities, partnerCentralOpportunities } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme-recon" },
      { id: tenantB, name: "Globex", slug: "globex-recon" },
    ]);
    const ins = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@a.recon", role: "owner" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@b.recon", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = ins.find((u) => u.sub === "owner-a")!.id;
    ownerB = ins.find((u) => u.sub === "owner-b")!.id;

    const oppIns = await tx
      .insert(opportunities)
      .values([
        { tenantId: tenantA, name: "Globex Local", accountName: "Globex", stage: "qualified", status: "open", amount: 1000, externalId: "PC-1" },
        { tenantId: tenantA, name: "Manual Deal", accountName: "Direct", stage: "prospect", status: "open", amount: 42, externalId: null },
        { tenantId: tenantB, name: "B Deal", accountName: "BCo", stage: "qualified", status: "open", amount: 10, externalId: "PC-1" },
      ])
      .returning({ id: opportunities.id, name: opportunities.name });
    driftOppA = oppIns.find((o) => o.name === "Globex Local")!.id;
    manualOppA = oppIns.find((o) => o.name === "Manual Deal")!.id;

    await tx.insert(partnerCentralOpportunities).values([
      // A's mirror for PC-1 disagrees with the local opp on every field.
      { tenantId: tenantA, externalId: "PC-1", name: "Globex Inc (AWS)", accountName: "Globex Inc", stage: "business_validation", status: "open", amount: 120_000, awsStageRaw: "Business Validation" },
      // B's mirror for PC-1 — present only to prove cross-tenant can't leak.
      { tenantId: tenantB, externalId: "PC-1", name: "B AWS", accountName: "BCo", stage: "launched", status: "won", amount: 999, awsStageRaw: "Launched" },
    ]);
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("acceptPartnerCentralTruthOp", () => {
  it("overwrites the local opp with its AWS mirror values (1:1 fields)", async () => {
    const r = await runAs(identity(tenantA, ownerA), "ace:update", "accept-1", (ctx) =>
      aws.acceptPartnerCentralTruthOp(ctx, { ids: [driftOppA] }),
    );
    expect(r.body.count).toBe(1);

    const [opp] = await db.client.withSystem((tx) =>
      tx.select().from(db.schema.opportunities).where(eq(db.schema.opportunities.id, driftOppA)),
    );
    expect(opp!.stage).toBe("business_validation");
    expect(opp!.amount).toBe(120_000);
    expect(opp!.name).toBe("Globex Inc (AWS)");
    expect(opp!.accountName).toBe("Globex Inc");
  });

  it("rejects an empty selection", async () => {
    await expect(
      runAs(identity(tenantA, ownerA), "ace:update", "accept-empty", (ctx) =>
        aws.acceptPartnerCentralTruthOp(ctx, { ids: [] }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("never touches a manual opp (null external id)", async () => {
    const r = await runAs(identity(tenantA, ownerA), "ace:update", "accept-manual", (ctx) =>
      aws.acceptPartnerCentralTruthOp(ctx, { ids: [manualOppA] }),
    );
    expect(r.body.count).toBe(0);
    const [opp] = await db.client.withSystem((tx) =>
      tx.select().from(db.schema.opportunities).where(eq(db.schema.opportunities.id, manualOppA)),
    );
    expect(opp!.amount).toBe(42); // unchanged
    expect(opp!.stage).toBe("prospect");
  });

  it("RLS: tenant B cannot accept-truth tenant A's opportunity", async () => {
    const r = await runAs(identity(tenantB, ownerB), "ace:update", "accept-cross", (ctx) =>
      aws.acceptPartnerCentralTruthOp(ctx, { ids: [driftOppA] }),
    );
    expect(r.body.count).toBe(0);
    // A's opp keeps the values from the first (legitimate) accept — untouched by B.
    const [opp] = await db.client.withSystem((tx) =>
      tx.select().from(db.schema.opportunities).where(eq(db.schema.opportunities.id, driftOppA)),
    );
    expect(opp!.name).toBe("Globex Inc (AWS)");
  });
});
