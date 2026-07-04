import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Cross-tenant benchmarking (Bet B, the NET-axis moat). Verifies the system-level
 * aggregation across opted-in tenants, k-anonymity (no cohort under MIN_COHORT is
 * written — including nullable metrics), the reciprocal opt-in gate on the loader,
 * and that the identity-free cohort store is readable across tenants.
 */

let db: TestDb;
let aggregate: typeof import("@/domain/benchmarks/aggregate");
let load: typeof import("@/domain/benchmarks/load");

const TODAY = "2026-07-01";

interface Spec {
  slug: string;
  tier: string;
  participate: boolean;
  health: number;
}

// 6 opted-in "advanced" partners (health spread), 1 opted-in "select" partner (alone
// -> its cohort is below k), 1 "advanced" non-participant (excluded + sees no peers).
const SPECS: Spec[] = [
  { slug: "adv1", tier: "advanced", participate: true, health: 40 },
  { slug: "adv2", tier: "advanced", participate: true, health: 50 },
  { slug: "adv3", tier: "advanced", participate: true, health: 60 },
  { slug: "adv4", tier: "advanced", participate: true, health: 70 },
  { slug: "adv5", tier: "advanced", participate: true, health: 80 },
  { slug: "adv6", tier: "advanced", participate: true, health: 90 },
  { slug: "sel1", tier: "select", participate: true, health: 55 },
  { slug: "nonp", tier: "advanced", participate: false, health: 100 },
];

const ids: Record<string, { tenantId: string; userId: string }> = {};
const identity = (slug: string) => ({ ...ids[slug]!, role: "owner" as const });

beforeAll(async () => {
  db = await setupTestDb();
  aggregate = await import("@/domain/benchmarks/aggregate");
  load = await import("@/domain/benchmarks/load");
  const { withSystem } = db.client;
  const { tenants, users, workspaceSettings, metricSnapshots } = db.schema;

  await withSystem(async (tx) => {
    const tRows = await tx
      .insert(tenants)
      .values(SPECS.map((s) => ({ name: s.slug, slug: s.slug, tier: s.tier as "advanced" })))
      .returning({ id: tenants.id, slug: tenants.slug });
    const bySlug = new Map(tRows.map((r) => [r.slug, r.id]));

    for (const s of SPECS) {
      const tenantId = bySlug.get(s.slug)!;
      const [u] = await tx
        .insert(users)
        .values({ tenantId, oidcSubject: `owner-${s.slug}`, email: `owner@${s.slug}.test`, role: "owner" })
        .returning({ id: users.id });
      ids[s.slug] = { tenantId, userId: u!.id };
      await tx.insert(workspaceSettings).values({ tenantId, benchmarkParticipation: s.participate });
      await tx.insert(metricSnapshots).values({
        tenantId,
        capturedOn: TODAY,
        openWork: 0,
        overdue: 0,
        activePrograms: 0,
        programsTotal: 0,
        tierPercent: null,
        healthScore: s.health,
        evidencePercent: 50,
        // win_rate + mdf_roi intentionally left null on every tenant.
      });
    }
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("benchmark aggregation", () => {
  it("aggregates opted-in tenants into an anonymized tier cohort with a correct median", async () => {
    const res = await aggregate.aggregateBenchmarks(TODAY);
    expect(res.tenantsIncluded).toBe(7); // 6 advanced + 1 select opted-in; non-participant excluded

    const { withSystem } = db.client;
    const { benchmarkCohorts } = db.schema;
    const [advHealth] = await withSystem((tx) =>
      tx
        .select()
        .from(benchmarkCohorts)
        .where(
          and(
            eq(benchmarkCohorts.cohortDimension, "tier"),
            eq(benchmarkCohorts.cohortValue, "advanced"),
            eq(benchmarkCohorts.metric, "health"),
          ),
        ),
    );
    expect(advHealth).toBeTruthy();
    expect(advHealth!.sampleCount).toBe(6);
    expect(advHealth!.p50).toBe(65); // median of [40,50,60,70,80,90]
  });

  it("enforces k-anonymity — a cohort under MIN_COHORT is never written", async () => {
    const { withSystem } = db.client;
    const { benchmarkCohorts } = db.schema;
    // Only one opted-in "select" tenant -> its cohort must not exist.
    const sel = await withSystem((tx) =>
      tx
        .select()
        .from(benchmarkCohorts)
        .where(and(eq(benchmarkCohorts.cohortDimension, "tier"), eq(benchmarkCohorts.cohortValue, "select"))),
    );
    expect(sel).toHaveLength(0);
    // Every tenant's win_rate is null -> the metric has 0 values -> no cohort even for advanced.
    const winRate = await withSystem((tx) =>
      tx
        .select()
        .from(benchmarkCohorts)
        .where(and(eq(benchmarkCohorts.cohortValue, "advanced"), eq(benchmarkCohorts.metric, "win_rate"))),
    );
    expect(winRate).toHaveLength(0);
  });
});

describe("benchmark loader", () => {
  it("returns positions for a participant and reads the cross-tenant cohort", async () => {
    const v = await load.loadBenchmarks(identity("adv3"));
    expect(v.participating).toBe(true);
    if (!v.participating) throw new Error("unreachable");
    expect(v.tier.value).toBe("advanced");
    const health = v.tier.positions.find((p) => p.key === "health");
    expect(health).toBeTruthy();
    expect(health!.value).toBe(60);
    expect(health!.cohortMedian).toBe(65); // read from the identity-free cohort store (cross-tenant)
    expect(health!.sampleCount).toBe(6);
    expect(health!.position?.band).toBe("below_median"); // 60 < p50 65
  });

  it("hides everything from a non-participant (reciprocal opt-in)", async () => {
    const v = await load.loadBenchmarks(identity("nonp"));
    expect(v.participating).toBe(false);
  });

  it("a nullable metric with no data has no cohort — position is null", async () => {
    const v = await load.loadBenchmarks(identity("adv3"));
    if (!v.participating) throw new Error("unreachable");
    const winRate = v.tier.positions.find((p) => p.key === "win_rate");
    expect(winRate).toBeTruthy();
    expect(winRate!.value).toBeNull();
    expect(winRate!.position).toBeNull();
    expect(winRate!.sampleCount).toBe(0);
  });
});
