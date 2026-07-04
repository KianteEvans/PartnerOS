import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";
import { narrativeOutline } from "@/domain/reports/narrative";
import type { ReportSnapshot } from "@/domain/reports/metrics";

/**
 * Saved executive narrative (drizzle/0052) through the gate: the deterministic
 * outline round-trips onto a DRAFT report (also proving the outline text survives
 * the embedded DB's encoding), the lifecycle freezes it, and snapshot regeneration
 * clears it.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/reports/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let ownerA = "";

function identity(tenantId: string, userId: string) {
  return {
    tenantId,
    userId,
    oidcSubject: `sub-${userId}`,
    epoch: 0,
    email: `${userId}@test`,
    role: "owner" as const,
  };
}
const idA = () => identity(tenantA, ownerA);

async function run<T>(permission: Permission, key: string, handler: (ctx: MutationContext) => Promise<T>) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "report.test", resourceType: "report", handler },
    { resolveIdentity: async () => idA() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/reports/operations");

  const { withSystem } = db.client;
  const { tenants, users, mdfRequests, tasks, tierPlans } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values({ id: tenantA, name: "Acme", slug: "acme" });
    const [u] = await tx
      .insert(users)
      .values({ tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" })
      .returning({ id: users.id });
    ownerA = u!.id;
    // Enough cross-section data that the snapshot has drivers and watch items.
    await tx.insert(mdfRequests).values({
      tenantId: tenantA,
      title: "Event",
      status: "approved",
      requestedAmount: 10_000,
      approvedAmount: 8_000,
      expectedPipeline: 40_000,
    });
    await tx.insert(tasks).values({
      tenantId: tenantA,
      title: "Overdue thing",
      status: "open",
      priority: "high",
      dueDate: "2026-01-01",
      createdBy: ownerA,
    });
    // A tier plan makes narrativeSummary emit its tier sentence — proving the
    // generated summary (not just the narrative) survives the WIN1252 encoding.
    await tx.insert(tierPlans).values({
      tenantId: tenantA,
      currentTier: "select",
      targetTier: "advanced",
      catalogVersion: 2,
      createdBy: ownerA,
    });
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("report narrative lifecycle", () => {
  it("saves the deterministic outline onto a draft report and reads it back intact", async () => {
    const created = await run("report:create", "gen-1", (ctx) =>
      ops.generateReportOp(ctx, { title: "Q3", reportType: "executive_plan", periodStart: null, periodEnd: null, today: "2026-07-02" }),
    );
    const id = created.body.id;

    const { withTenant } = db.client;
    const { reports } = db.schema;
    const [before] = await withTenant(idA(), (tx) => tx.select().from(reports).where(eq(reports.id, id)));
    expect(before!.narrative).toBe(""); // generation starts without a story
    // The generated summary's tier sentence uses an ASCII arrow so it can be
    // stored on a WIN1252 database (U+2192 cannot).
    expect(before!.summary).toContain("Tier select -> advanced");

    const outline = narrativeOutline(before!.snapshot as ReportSnapshot, null, "2026-07-02");
    expect(outline).toContain("partnership health stands at");

    await run("report:update", "narrative-1", (ctx) => ops.saveNarrativeOp(ctx, { id, narrative: outline }));

    const [after] = await withTenant(idA(), (tx) => tx.select().from(reports).where(eq(reports.id, id)));
    expect(after!.narrative).toBe(outline); // byte-for-byte round-trip (WIN1252-safe)
    expect(after!.status).toBe("draft"); // draft -> draft, no lifecycle movement
  });

  it("refuses to rewrite the narrative once the report leaves draft", async () => {
    const created = await run("report:create", "gen-2", (ctx) =>
      ops.generateReportOp(ctx, { title: "Frozen", reportType: "qbr", periodStart: null, periodEnd: null, today: "2026-07-02" }),
    );
    const id = created.body.id;
    await run("report:update", "review-2", (ctx) => ops.submitForReviewOp(ctx, { id }));

    await expect(
      run("report:update", "narrative-2", (ctx) => ops.saveNarrativeOp(ctx, { id, narrative: "too late" })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("clears the saved narrative when the snapshot is regenerated", async () => {
    const created = await run("report:create", "gen-3", (ctx) =>
      ops.generateReportOp(ctx, { title: "Regen", reportType: "executive_plan", periodStart: null, periodEnd: null, today: "2026-07-02" }),
    );
    const id = created.body.id;
    await run("report:update", "narrative-3", (ctx) => ops.saveNarrativeOp(ctx, { id, narrative: "The old story." }));
    await run("report:update", "regen-3", (ctx) => ops.regenerateReportOp(ctx, { id, today: "2026-07-02" }));

    const { withTenant } = db.client;
    const { reports } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select({ narrative: reports.narrative }).from(reports).where(eq(reports.id, id)));
    expect(r!.narrative).toBe(""); // a stale story is worse than none
  });
});
