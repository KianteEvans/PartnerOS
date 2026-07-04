import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Full ROI loop (Wave 2). Verifies the loader attributes REALIZED (won) revenue back
 * to approved spend — via the new MDF opportunity_id FK AND the free-text ref fallback
 * for un-migrated rows — folds it into the funnel with correct leaks, excludes
 * un-approved spend, and isolates tenants under RLS.
 */

let db: TestDb;
let load: typeof import("@/domain/roi/load");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let wonId = "";
let open2Id = "";

const idA = () => ({ tenantId: tenantA, userId: ownerA, role: "owner" });
const idB = () => ({ tenantId: tenantB, userId: ownerB, role: "owner" });

beforeAll(async () => {
  db = await setupTestDb();
  load = await import("@/domain/roi/load");
  const { withSystem } = db.client;
  const { tenants, users, opportunities, mdfRequests, fundingSubmissions } = db.schema;

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

    const opps = await tx
      .insert(opportunities)
      .values([
        { tenantId: tenantA, name: "Won deal", status: "won", stage: "launched", amount: 200000, externalId: "EXT-1" },
        { tenantId: tenantA, name: "Open deal", status: "open", stage: "qualified", amount: 90000 },
        { tenantId: tenantA, name: "Second open", status: "open", stage: "qualified", amount: 60000 },
        // tenant B's own won deal (must never appear in tenant A's ROI loop).
        { tenantId: tenantB, name: "B won", status: "won", stage: "launched", amount: 999999 },
      ])
      .returning({ id: opportunities.id, name: opportunities.name });
    wonId = opps.find((o) => o.name === "Won deal")!.id;
    open2Id = opps.find((o) => o.name === "Second open")!.id;

    await tx.insert(mdfRequests).values([
      // FK link -> won deal (realized revenue).
      { tenantId: tenantA, title: "m-fk", approvedAmount: 40000, expectedPipeline: 100000, opportunityId: wonId },
      // free-text ref fallback -> open deal (in-flight), no FK.
      { tenantId: tenantA, title: "m-ref", approvedAmount: 20000, expectedPipeline: 50000, opportunityRef: "Open deal" },
      // unlinked -> a leak.
      { tenantId: tenantA, title: "m-leak", approvedAmount: 5000, expectedPipeline: 10000, opportunityRef: "Nope" },
      // not approved -> excluded from the funnel.
      { tenantId: tenantA, title: "m-draft", approvedAmount: null, expectedPipeline: 999999 },
    ]);
    await tx.insert(fundingSubmissions).values([
      { tenantId: tenantA, programKey: "map", title: "f-fk", approvedAmount: 15000, opportunityId: open2Id },
      { tenantId: tenantA, programKey: "poc", title: "f-draft", approvedAmount: null },
    ]);
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("loadRoiLoop", () => {
  it("attributes realized won revenue to spend and folds the funnel", async () => {
    const v = await load.loadRoiLoop(idA());
    const f = v.funnel;
    expect(f.records).toHaveLength(4); // 2 MDF approved + 1 ref + 1 funding; drafts excluded
    expect(f.approvedSpend).toBe(80000); // 40000 + 20000 + 5000 + 15000
    expect(f.expectedPipeline).toBe(160000); // 100000 + 50000 + 10000 + 0
    expect(f.influencedWon).toBe(200000); // the FK-linked won deal
    expect(f.influencedOpen).toBe(150000); // 90000 (ref) + 60000 (funding FK)
    expect(f.realizedRoi).toBe(2.5); // 200000 / 80000
    expect(f.launchedCredits).toBe(1); // won deal is launched
    expect(f.inFlightCount).toBe(2); // both open deals
    expect(f.unlinkedSpend).toBe(5000); // the m-leak row
  });

  it("resolves the MDF free-text ref fallback to the right opportunity", async () => {
    const v = await load.loadRoiLoop(idA());
    const ref = v.funnel.records.find((r) => r.title === "m-ref");
    expect(ref?.opp?.name).toBe("Open deal");
    expect(ref?.influencedOpen).toBe(90000);
  });

  it("isolates tenants under RLS", async () => {
    const v = await load.loadRoiLoop(idB());
    expect(v.funnel.records).toHaveLength(0);
    expect(v.funnel.influencedWon).toBe(0);
  });
});
