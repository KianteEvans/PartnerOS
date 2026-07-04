import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Per-roadmap burn-up history (Trajectory forecast): the materialize-on-read daily
 * capture + the series read, including same-day idempotency, per-roadmap scoping,
 * tenant RLS isolation, and the WITH CHECK forge guard.
 */

let db: TestDb;
let trends: typeof import("@/domain/roadmaps/trends-load");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const roadmapA = "11111111-1111-1111-1111-111111111111";
const roadmapA2 = "22222222-2222-2222-2222-222222222222";
const roadmapB = "33333333-3333-3333-3333-333333333333";
let ownerA = "";
let ownerB = "";

const idA = () => ({ tenantId: tenantA, userId: ownerA, role: "owner" as const });
const idB = () => ({ tenantId: tenantB, userId: ownerB, role: "owner" as const });

const vals = (over: Partial<import("@/domain/roadmaps/trends-load").RoadmapSnapshotValues>) => ({
  done: 1,
  total: 4,
  overdue: 0,
  inProgress: 1,
  ...over,
});

beforeAll(async () => {
  db = await setupTestDb();
  trends = await import("@/domain/roadmaps/trends-load");
  const { withSystem } = db.client;
  const { tenants, users, roadmaps } = db.schema;
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
    await tx.insert(roadmaps).values([
      { id: roadmapA, tenantId: tenantA, name: "RA", startDate: "2026-01-01" },
      { id: roadmapA2, tenantId: tenantA, name: "RA2", startDate: "2026-01-01" },
      { id: roadmapB, tenantId: tenantB, name: "RB", startDate: "2026-01-01" },
    ]);
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("roadmap snapshots", () => {
  it("captures a daily series and reads it chronologically", async () => {
    await trends.captureRoadmapSnapshot(idA(), roadmapA, vals({ done: 1 }), "2026-06-20");
    await trends.captureRoadmapSnapshot(idA(), roadmapA, vals({ done: 2 }), "2026-06-21");
    await trends.captureRoadmapSnapshot(idA(), roadmapA, vals({ done: 4 }), "2026-06-22");

    const series = await trends.loadRoadmapTrends(idA(), roadmapA);
    expect(series.map((p) => p.done)).toEqual([1, 2, 4]); // chronological, newest last
    expect(series.map((p) => p.capturedOn)).toEqual(["2026-06-20", "2026-06-21", "2026-06-22"]);
  });

  it("is idempotent per day — re-capture updates the row, no duplicate", async () => {
    await trends.captureRoadmapSnapshot(idA(), roadmapA, vals({ done: 3 }), "2026-06-22");
    const series = await trends.loadRoadmapTrends(idA(), roadmapA);
    expect(series.map((p) => p.done)).toEqual([1, 2, 3]); // still 3 points; last day overwritten
  });

  it("scopes snapshots by roadmap, not just tenant", async () => {
    await trends.captureRoadmapSnapshot(idA(), roadmapA2, vals({ done: 9 }), "2026-06-22");
    expect((await trends.loadRoadmapTrends(idA(), roadmapA)).map((p) => p.done)).toEqual([1, 2, 3]);
    expect((await trends.loadRoadmapTrends(idA(), roadmapA2)).map((p) => p.done)).toEqual([9]);
  });

  it("isolates tenants (RLS) — B cannot read A's roadmap snapshots", async () => {
    expect(await trends.loadRoadmapTrends(idB(), roadmapA)).toEqual([]);
  });

  it("WITH CHECK blocks forging another tenant's snapshot", async () => {
    const { withTenant } = db.client;
    const { roadmapSnapshots } = db.schema;
    await expect(
      withTenant(idB(), (tx) =>
        tx.insert(roadmapSnapshots).values({
          tenantId: tenantA,
          roadmapId: roadmapA,
          capturedOn: "2026-06-25",
          done: 1,
          total: 1,
          overdue: 0,
          inProgress: 0,
        }),
      ),
    ).rejects.toThrow();
  });
});
