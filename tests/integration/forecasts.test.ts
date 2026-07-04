import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import { addDays } from "@/domain/dates";

/**
 * Forecasting suite (Wave 3). Verifies the loader projects each series from real
 * snapshot rows under RLS: an ordered Monte-Carlo revenue band, a roadmap completion
 * forecast, an ROI-weighted budget plan whose allocations sum to the remaining budget,
 * same-day determinism (seeded PRNG), and tenant isolation.
 */

let db: TestDb;
let load: typeof import("@/domain/forecast/load");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";

const idA = () => ({ tenantId: tenantA, userId: ownerA, role: "owner" });
const idB = () => ({ tenantId: tenantB, userId: ownerB, role: "owner" });
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  db = await setupTestDb();
  load = await import("@/domain/forecast/load");
  const { withSystem } = db.client;
  const {
    tenants,
    users,
    marketplaceRevenueSnapshots,
    metricSnapshots,
    roadmaps,
    roadmapMilestones,
    roadmapSnapshots,
    mdfBudgets,
    mdfRequests,
  } = db.schema;

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

    // 10 daily revenue + metric snapshots, rising with a wobble (tenant A only).
    for (let i = 10; i >= 1; i--) {
      const day = addDays(today, -i);
      const k = 10 - i;
      await tx.insert(marketplaceRevenueSnapshots).values({
        tenantId: tenantA,
        capturedOn: day,
        listings: 2,
        published: 1,
        activeEntitlements: 2,
        meteredUsageCents: 1_000_000 + k * 40_000,
        attributedRevenueCents: 2_000_000 + k * 50_000 + (k % 3) * 20_000,
        mrrCents: 800_000 + k * 10_000,
      });
      await tx.insert(metricSnapshots).values({
        tenantId: tenantA,
        capturedOn: day,
        openWork: 4,
        overdue: 1,
        activePrograms: 2,
        programsTotal: 4,
        tierPercent: 50,
        healthScore: 60 + k,
        marketplacePublished: 1,
        marketplaceActiveEntitlements: 2,
        marketplaceAttributedRevenueCents: 2_000_000,
        winRatePercent: 40 + (k % 5),
        evidencePercent: 60,
        mdfRoiX100: 400,
      });
    }

    // Finalized roadmap: 3 milestones (1 done), burn-up snapshots stepping 0 -> 1.
    const [rm] = await tx
      .insert(roadmaps)
      .values({ tenantId: tenantA, name: "Path to Advanced", status: "finalized", startDate: addDays(today, -30), createdBy: ownerA })
      .returning({ id: roadmaps.id });
    await tx.insert(roadmapMilestones).values([
      { tenantId: tenantA, roadmapId: rm!.id, sequence: 1, title: "M1", targetDate: addDays(today, 20), status: "done", originKind: "program", originRef: "a" },
      { tenantId: tenantA, roadmapId: rm!.id, sequence: 2, title: "M2", targetDate: addDays(today, 40), status: "planned", originKind: "program", originRef: "b" },
      { tenantId: tenantA, roadmapId: rm!.id, sequence: 3, title: "M3", targetDate: addDays(today, 60), status: "planned", originKind: "tier", originRef: "c" },
    ]);
    for (let i = 8; i >= 1; i--) {
      await tx.insert(roadmapSnapshots).values({
        tenantId: tenantA,
        roadmapId: rm!.id,
        capturedOn: addDays(today, -i),
        done: i <= 4 ? 1 : 0, // milestone completed ~4 days ago
        total: 3,
        overdue: 0,
        inProgress: 1,
      });
    }

    // Active budget + two approved MDF activities with distinct ROIs inside the period.
    await tx.insert(mdfBudgets).values({
      tenantId: tenantA,
      periodLabel: "H2",
      periodStart: addDays(today, -20),
      periodEnd: addDays(today, 40),
      amount: 50_000,
      createdBy: ownerA,
    });
    await tx.insert(mdfRequests).values([
      { tenantId: tenantA, title: "Event A", activityType: "event", status: "approved", requestedAmount: 12_000, approvedAmount: 10_000, expectedPipeline: 60_000, startDate: addDays(today, -5), createdBy: ownerA },
      { tenantId: tenantA, title: "Campaign B", activityType: "campaign", status: "approved", requestedAmount: 12_000, approvedAmount: 10_000, expectedPipeline: 20_000, startDate: addDays(today, -3), createdBy: ownerA },
    ]);
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("loadForecasts", () => {
  it("projects revenue with an ordered Monte-Carlo band and metric trajectories", async () => {
    const v = await load.loadForecasts(idA());
    expect(v.revenue).not.toBeNull();
    expect(v.revenue!.projection).not.toBeNull();
    const band = v.revenue!.projection!.band;
    expect(band).toHaveLength(90);
    for (const bp of band) {
      expect(bp.p10).toBeLessThanOrEqual(bp.p50);
      expect(bp.p50).toBeLessThanOrEqual(bp.p90);
      expect(bp.p10).toBeGreaterThanOrEqual(0);
    }
    expect(v.health?.projection).not.toBeNull();
    expect(v.health!.projection!.band.every((b) => b.p90 <= 100)).toBe(true); // capped
    expect(v.winRate?.projection).not.toBeNull();
  });

  it("forecasts roadmap completion and an ROI-weighted budget plan summing to remaining", async () => {
    const v = await load.loadForecasts(idA());
    const rm = v.roadmaps[0]!;
    expect(rm.done).toBe(1);
    expect(rm.total).toBe(3);
    expect(rm.mc).not.toBeNull();
    expect(rm.mc!.p50Date).not.toBeNull(); // some observed progress -> completes
    expect(rm.mc!.hitProbability).toBeGreaterThanOrEqual(0);
    expect(rm.plannedEnd).toBe(addDays(today, 60));

    expect(v.budget).not.toBeNull();
    expect(v.budget!.status.remaining).toBe(30_000); // 50k - 20k approved in period
    const plan = v.budget!.plan!;
    expect(plan.allocations.reduce((s, a) => s + a.amount, 0)).toBe(30_000);
    // Event ROI 6x beats campaign 2x -> bigger share.
    expect(plan.allocations[0]!.activityType).toBe("event");
    expect(plan.allocations[0]!.amount).toBeGreaterThan(plan.allocations[1]!.amount);
  });

  it("is deterministic within a day (seeded by tenant + date)", async () => {
    const a = await load.loadForecasts(idA());
    const b = await load.loadForecasts(idA());
    expect(a.revenue!.projection!.terminal).toEqual(b.revenue!.projection!.terminal);
    expect(a.roadmaps[0]!.mc).toEqual(b.roadmaps[0]!.mc);
  });

  it("isolates tenants under RLS", async () => {
    const v = await load.loadForecasts(idB());
    expect(v.revenue).toBeNull();
    expect(v.health).toBeNull();
    expect(v.roadmaps).toHaveLength(0);
    expect(v.budget).toBeNull();
  });
});
