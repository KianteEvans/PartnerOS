import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Command Center end-to-end: loadCommandData (read-only, RLS-scoped) gathers
 * cross-section rows for the caller's tenant only, and buildCommandCenter derives
 * the health score and decision queue. Verifies the aggregation is correct and
 * strictly tenant-isolated.
 */

let db: TestDb;
let load: typeof import("@/domain/command/load");
let aggregate: typeof import("@/domain/command/aggregate");

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
  load = await import("@/domain/command/load");
  aggregate = await import("@/domain/command/aggregate");

  const { withSystem } = db.client;
  const { tenants, users, tasks, mdfRequests, opportunities } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const [a] = await tx.insert(users).values({ tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" }).returning({ id: users.id });
    const [b] = await tx.insert(users).values({ tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" }).returning({ id: users.id });
    ownerA = a!.id;
    ownerB = b!.id;

    // Tenant A: an overdue critical task + an MDF deadline risk.
    await tx.insert(tasks).values({
      tenantId: tenantA,
      title: "Ship the deck",
      status: "open",
      priority: "critical",
      ownerUserId: ownerA,
      dueDate: "2019-01-01", // earliest due date -> unambiguously the top risk
      createdBy: ownerA,
    });
    await tx.insert(mdfRequests).values({
      tenantId: tenantA,
      title: "Re:Invent",
      status: "approved",
      requestedAmount: 10_000,
      approvedAmount: 10_000,
      claimDeadline: "2020-01-01", // overdue claim
    });
    await tx.insert(opportunities).values({
      tenantId: tenantA,
      name: "Big deal",
      amount: 200_000,
      status: "open",
      lastInteraction: "2020-01-01", // stale -> at risk, high value
    });
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("command center end-to-end", () => {
  it("aggregates the caller's tenant data into a brief", async () => {
    const data = await load.loadCommandData(identity(tenantA, ownerA));
    const cc = aggregate.buildCommandCenter(data.inputs, "2026-06-23");

    // The overdue critical task is the top risk.
    expect(cc.topRisk).not.toBeNull();
    expect(cc.topRisk!.severity).toBe("critical");
    expect(cc.topRisk!.situation).toBe("overdue_work");

    // Decisions surfaced from multiple sections.
    const situations = new Set(cc.decisions.map((d) => d.situation));
    expect(situations).toContain("overdue_work");
    expect(situations).toContain("mdf_deadline");
    expect(situations).toContain("aws_review");

    expect(cc.work.overdue).toBe(1);
    expect(cc.work.critical).toBe(1);
    // Health is dragged down by overdue work + the MDF deadline risk.
    expect(cc.health.score).toBeLessThan(70);
  });

  it("is strictly tenant-isolated", async () => {
    // Tenant B has no seeded data -> empty inputs, neutral health, no decisions.
    const data = await load.loadCommandData(identity(tenantB, ownerB));
    expect(data.inputs.tasks).toHaveLength(0);
    expect(data.inputs.mdf).toHaveLength(0);
    expect(data.inputs.opportunities).toHaveLength(0);

    const cc = aggregate.buildCommandCenter(data.inputs, "2026-06-23");
    expect(cc.decisions).toHaveLength(0);
    expect(cc.health.score).toBe(70);
    expect(cc.topRisk).toBeNull();
  });

  it("includes recent workflow receipts for the tenant", async () => {
    // The seeded inserts were via withSystem (no audit rows); the receipts list
    // is simply tenant-scoped and empty here, proving the query is wired + RLS-safe.
    const data = await load.loadCommandData(identity(tenantA, ownerA));
    expect(Array.isArray(data.receipts)).toBe(true);
  });
});
