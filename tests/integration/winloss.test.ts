import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Win/loss mining (Wave 2 finale). Verifies the loader mines closed deals with the
 * cross-domain factor links (MDF via FK AND free-text ref fallback, AWS-team via
 * awsContactId), computes rep win rows, isolates tenants under RLS — and that the
 * capture path stamps closed_at + loss_reason on status transitions (and clears them
 * on reopen / win).
 */

let db: TestDb;
let load: typeof import("@/domain/ace/winloss-load");
let aceOps: typeof import("@/domain/ace/operations");
let gate: typeof import("@/gate/mutation-gate");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let relA = "";
let captureOpp = "";

function identity(tenantId: string, userId: string) {
  return { tenantId, userId, oidcSubject: `sub-${userId}`, epoch: 0, email: `${userId}@test`, role: "owner" as const };
}
const idA = () => identity(tenantA, ownerA);
const idB = () => identity(tenantB, ownerB);

async function run<T>(permission: Permission, key: string, handler: (ctx: MutationContext) => Promise<T>, who = idA) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "winloss.test", resourceType: "opportunity", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  load = await import("@/domain/ace/winloss-load");
  aceOps = await import("@/domain/ace/operations");
  gate = await import("@/gate/mutation-gate");

  const { withSystem } = db.client;
  const { tenants, users, opportunities, aceRelationships, mdfRequests } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const us = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "own-a", email: "a@a.test", role: "owner" },
        { tenantId: tenantB, oidcSubject: "own-b", email: "b@b.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = us.find((u) => u.sub === "own-a")!.id;
    ownerB = us.find((u) => u.sub === "own-b")!.id;

    const [rel] = await tx
      .insert(aceRelationships)
      .values({ tenantId: tenantA, name: "Jane", role: "seller", accountName: "Globex", strength: 80, createdBy: ownerA })
      .returning({ id: aceRelationships.id });
    relA = rel!.id;

    const opps = await tx
      .insert(opportunities)
      .values([
        // Won, AWS-contact-attributed, MDF-backed via FK (below).
        { tenantId: tenantA, name: "Won FK", status: "won", stage: "launched", amount: 200_000, source: "amazon_originated", awsContactId: relA, closedAt: new Date("2026-05-01"), nextStep: "" },
        // Lost, MDF-backed via free-text ref (name), with a recorded reason.
        { tenantId: tenantA, name: "Lost Ref", status: "lost", stage: "qualified", amount: 50_000, source: "partner_originated", lossReason: "price", closedAt: new Date("2026-05-10"), nextStep: "" },
        // Open — excluded from mining, still used to test the capture path below.
        { tenantId: tenantA, name: "Capture me", status: "open", stage: "qualified", amount: 10_000, source: "partner_originated", nextStep: "" },
        // Tenant B's closed deal must never leak into A's mining.
        { tenantId: tenantB, name: "B won", status: "won", stage: "launched", amount: 999_999, source: "marketplace", nextStep: "" },
      ])
      .returning({ id: opportunities.id, name: opportunities.name });
    const wonId = opps.find((o) => o.name === "Won FK")!.id;
    captureOpp = opps.find((o) => o.name === "Capture me")!.id;

    await tx.insert(mdfRequests).values([
      { tenantId: tenantA, title: "m-fk", approvedAmount: 10_000, expectedPipeline: 0, opportunityId: wonId },
      { tenantId: tenantA, title: "m-ref", approvedAmount: 5_000, expectedPipeline: 0, opportunityRef: "Lost Ref" },
    ]);
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("win/loss mining", () => {
  it("mines closed deals with MDF FK + ref-fallback factors and rep attribution", async () => {
    const v = await load.loadWinLoss(idA());
    expect(v.report.overall).toMatchObject({ closed: 2, won: 1, lost: 1, winRate: 50 });

    // Both closed deals are MDF-backed (one FK, one free-text ref).
    const won = v.deals.find((d) => d.name === "Won FK")!;
    const lost = v.deals.find((d) => d.name === "Lost Ref")!;
    expect(won.hasMdf).toBe(true);
    expect(won.hasAwsTeam).toBe(true); // via awsContactId
    expect(lost.hasMdf).toBe(true); // via opportunity_ref fallback
    expect(lost.lossReason).toBe("price");
    expect(v.report.lossReasons[0]).toMatchObject({ reason: "price", count: 1, lostTCV: 50_000 });

    // Rep win intelligence: Jane gets the won deal via the direct contact link.
    expect(v.reps[0]).toMatchObject({ id: relA, closed: 1, won: 1, winRate: 100, wonTCV: 200_000 });
  });

  it("isolates tenants under RLS", async () => {
    const v = await load.loadWinLoss(idB());
    expect(v.report.overall.closed).toBe(1); // only B's own deal
    expect(v.deals.some((d) => d.name === "Won FK")).toBe(false);
    expect(v.reps).toHaveLength(0);
  });

  it("capture path: lost stamps closed_at + reason; won clears reason; reopen clears both", async () => {
    const { opportunities } = db.schema;
    const read = async () =>
      (await db.client.withTenant(idA(), (tx) =>
        tx
          .select({ status: opportunities.status, lossReason: opportunities.lossReason, closedAt: opportunities.closedAt })
          .from(opportunities)
          .where(eq(opportunities.id, captureOpp)),
      ))[0]!;

    await run("ace:update", "wl-lose", (ctx) =>
      aceOps.updateOpportunityOp(ctx, { id: captureOpp, status: "lost", lossReason: "competitor" }),
    );
    let row = await read();
    expect(row.status).toBe("lost");
    expect(row.lossReason).toBe("competitor");
    expect(row.closedAt).not.toBeNull();

    // Re-saving without a status change must not clear/restamp anything.
    await run("ace:update", "wl-touch", (ctx) => aceOps.updateOpportunityOp(ctx, { id: captureOpp, status: "lost", amount: 11_000 }));
    row = await read();
    expect(row.lossReason).toBe("competitor");

    await run("ace:update", "wl-reopen", (ctx) => aceOps.updateOpportunityOp(ctx, { id: captureOpp, status: "open" }));
    row = await read();
    expect(row.status).toBe("open");
    expect(row.lossReason).toBe("");
    expect(row.closedAt).toBeNull();

    await run("ace:update", "wl-win", (ctx) =>
      aceOps.updateOpportunityOp(ctx, { id: captureOpp, status: "won", lossReason: "competitor" }),
    );
    row = await read();
    expect(row.status).toBe("won");
    expect(row.lossReason).toBe(""); // winning clears any submitted reason
    expect(row.closedAt).not.toBeNull();
  });
});
