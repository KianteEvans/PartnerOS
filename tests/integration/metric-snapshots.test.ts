import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Dense metric history (Tier 3): the materialize-on-read daily capture + the
 * sparkline series read, including same-day idempotency and RLS isolation.
 */

let db: TestDb;
let trends: typeof import("@/domain/command/trends-load");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";

const idA = () => ({ tenantId: tenantA, userId: ownerA, role: "owner" });
const idB = () => ({ tenantId: tenantB, userId: ownerB, role: "owner" });

const vals = (over: Partial<import("@/domain/command/trends-load").MetricSnapshotValues>) => ({
  openWork: 5,
  overdue: 1,
  activePrograms: 2,
  programsTotal: 7,
  tierPercent: 40,
  healthScore: 70,
  ...over,
});

beforeAll(async () => {
  db = await setupTestDb();
  trends = await import("@/domain/command/trends-load");
  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const ins = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = ins.find((u) => u.sub === "owner-a")!.id;
    ownerB = ins.find((u) => u.sub === "owner-b")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("metric snapshots", () => {
  it("captures a daily series and reads it chronologically", async () => {
    await trends.captureMetricSnapshot(idA(), vals({ openWork: 5, tierPercent: 40 }), "2026-06-20");
    await trends.captureMetricSnapshot(idA(), vals({ openWork: 8, tierPercent: 48 }), "2026-06-21");
    await trends.captureMetricSnapshot(idA(), vals({ openWork: 12, tierPercent: 55 }), "2026-06-22");

    const h = await trends.loadHubTrends(idA());
    expect(h.openWork).toEqual([5, 8, 12]); // chronological, newest last
    expect(h.tierProgress).toEqual([40, 48, 55]);
  });

  it("is idempotent per day — re-capture updates the row, no duplicate", async () => {
    await trends.captureMetricSnapshot(idA(), vals({ openWork: 99, tierPercent: 60 }), "2026-06-22");
    const h = await trends.loadHubTrends(idA());
    expect(h.openWork).toEqual([5, 8, 99]); // still 3 points; the last day was overwritten
    expect(h.tierProgress).toEqual([40, 48, 60]);
  });

  it("stores a null tier as 0 in the series", async () => {
    await trends.captureMetricSnapshot(idA(), vals({ tierPercent: null }), "2026-06-23");
    const h = await trends.loadHubTrends(idA());
    expect(h.tierProgress[h.tierProgress.length - 1]).toBe(0);
  });

  it("isolates tenants (RLS)", async () => {
    expect((await trends.loadHubTrends(idB())).openWork).toEqual([]);
  });
});
