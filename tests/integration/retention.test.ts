import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Data-retention sweep (src/domain/retention/operations.ts). Verifies it prunes
 * ONLY rows past their window — completed idempotency keys > 7d and metric
 * snapshots > 730d — while leaving fresh + in-flight rows intact, and that a
 * second run is a clean no-op.
 */

let db: TestDb;
let ret: typeof import("@/domain/retention/operations");

const T = "eeeeeeee-0000-0000-0000-000000000001";
const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);
const dateAgo = (n: number): string => daysAgo(n).toISOString().slice(0, 10);

beforeAll(async () => {
  db = await setupTestDb();
  ret = await import("@/domain/retention/operations");
  const { withSystem } = db.client;
  const { tenants, idempotencyKeys, metricSnapshots } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values({ id: T, name: "Ret Co", slug: "ret-co" });
    await tx.insert(idempotencyKeys).values([
      { tenantId: T, key: "old-done", requestHash: "h1", completedAt: daysAgo(10) },
      { tenantId: T, key: "recent-done", requestHash: "h2", completedAt: daysAgo(1) },
      // In-flight (never completed) — must survive regardless of age.
      { tenantId: T, key: "old-inflight", requestHash: "h3", createdAt: daysAgo(30) },
    ]);
    await tx.insert(metricSnapshots).values([
      { tenantId: T, capturedOn: dateAgo(800) },
      { tenantId: T, capturedOn: dateAgo(100) },
    ]);
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("data retention sweep", () => {
  it("prunes only rows past their window", async () => {
    const { withSystem } = db.client;
    const { idempotencyKeys, metricSnapshots } = db.schema;

    const result = await withSystem((tx) => ret.runRetentionOp(tx));
    expect(result.idempotencyDeleted).toBe(1); // only the old COMPLETED key
    expect(result.snapshotsDeleted).toBe(1); // only the 800-day-old snapshot

    const idemp = await withSystem((tx) =>
      tx.select({ key: idempotencyKeys.key }).from(idempotencyKeys).where(eq(idempotencyKeys.tenantId, T)),
    );
    expect(idemp.map((r) => r.key).sort()).toEqual(["old-inflight", "recent-done"]);

    const snaps = await withSystem((tx) =>
      tx.select({ id: metricSnapshots.id }).from(metricSnapshots).where(eq(metricSnapshots.tenantId, T)),
    );
    expect(snaps).toHaveLength(1);
  });

  it("is a clean no-op on a second run", async () => {
    const { withSystem } = db.client;
    const result = await withSystem((tx) => ret.runRetentionOp(tx));
    expect(result.idempotencyDeleted).toBe(0);
    expect(result.snapshotsDeleted).toBe(0);
  });
});
