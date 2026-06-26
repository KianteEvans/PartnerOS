import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Reporting end-to-end through the gate: generation snapshots metrics aggregated
 * from across sections, the draft -> reviewed -> approved lifecycle (approval
 * gated to manager+ and blocked on empty data), draft-only regeneration, and
 * cross-tenant RLS.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/reports/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let memberA = "";

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
const idA = () => identity(tenantA, ownerA);

let reportId = "";
let emptyReportId = "";

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
  who = idA,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "report.test", resourceType: "report", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/reports/operations");

  const { withSystem } = db.client;
  const { tenants, users, mdfRequests, opportunities } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const inserted = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" },
        { tenantId: tenantA, oidcSubject: "member-a", email: "member@acme.test", role: "member" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = inserted.find((u) => u.sub === "owner-a")!.id;
    memberA = inserted.find((u) => u.sub === "member-a")!.id;
    ownerB = inserted.find((u) => u.sub === "owner-b")!.id;

    // Seed cross-section data for tenant A so the snapshot is non-empty.
    await tx.insert(mdfRequests).values({
      tenantId: tenantA,
      title: "Event",
      status: "approved",
      requestedAmount: 10_000,
      approvedAmount: 8_000,
      expectedPipeline: 40_000,
    });
    await tx.insert(opportunities).values({
      tenantId: tenantA,
      name: "Acme migration",
      amount: 100_000,
      status: "open",
      source: "amazon_originated",
    });
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("reports end-to-end", () => {
  it("generates a report with an aggregated snapshot", async () => {
    const res = await run("report:create", "generate", (ctx) =>
      ops.generateReportOp(ctx, { title: "Q3 Review", reportType: "executive_plan", periodStart: null, periodEnd: null, today: "2026-06-23" }),
    );
    reportId = res.body.id;

    const { withTenant } = db.client;
    const { reports } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(reports).where(eq(reports.id, reportId)));
    expect(r!.status).toBe("draft");
    const snap = r!.snapshot as { mdf: { approved: number; roi: number | null }; ace: { open: number; openValue: number } };
    expect(snap.mdf.approved).toBe(8_000);
    expect(snap.mdf.roi).toBe(5); // 40k pipeline / 8k approved
    expect(snap.ace.open).toBe(1);
    expect(snap.ace.openValue).toBe(100_000);
    expect(r!.summary).toContain("Executive Partnership Plan");
  });

  it("rejects generation by a viewer", async () => {
    await expect(
      run("report:create", "generate-viewer", (ctx) =>
        ops.generateReportOp(ctx, { title: "x", reportType: "qbr", periodStart: null, periodEnd: null, today: "2026-06-23" }),
        () => identity(tenantA, ownerA, "viewer"),
      ),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("walks draft -> reviewed -> approved, gating approval to manager+", async () => {
    await run("report:update", "review", (ctx) => ops.submitForReviewOp(ctx, { id: reportId }));

    // A member cannot approve.
    await expect(
      run("report:approve", "approve-member", (ctx) => ops.approveReportOp(ctx, { id: reportId }), () => identity(tenantA, memberA, "member")),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);

    const res = await run("report:approve", `report-approve:${reportId}`, (ctx) => ops.approveReportOp(ctx, { id: reportId }));
    expect(res.body.status).toBe("approved");

    const { withTenant } = db.client;
    const { reports } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(reports).where(eq(reports.id, reportId)));
    expect(r!.status).toBe("approved");
    expect(r!.reviewedBy).toBe(ownerA);
    expect(r!.approvedBy).toBe(ownerA);
  });

  it("marks an approved report exported and guards re-transition", async () => {
    const res = await run("report:update", "export", (ctx) => ops.markExportedOp(ctx, { id: reportId }));
    expect(res.body.status).toBe("exported");
    await expect(
      run("report:update", "review-again", (ctx) => ops.submitForReviewOp(ctx, { id: reportId })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("blocks approving an empty report (preflight not ready)", async () => {
    // Tenant B has no seeded data -> empty snapshot.
    const idB = () => identity(tenantB, ownerB);
    const created = await run("report:create", "b-generate", (ctx) =>
      ops.generateReportOp(ctx, { title: "Empty", reportType: "custom", periodStart: null, periodEnd: null, today: "2026-06-23" }), idB);
    emptyReportId = created.body.id;
    await run("report:update", "b-review", (ctx) => ops.submitForReviewOp(ctx, { id: emptyReportId }), idB);
    await expect(
      run("report:approve", `report-approve:${emptyReportId}`, (ctx) => ops.approveReportOp(ctx, { id: emptyReportId }), idB),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("regenerates only a draft report", async () => {
    // reportId is exported now -> regenerate is rejected.
    await expect(
      run("report:update", "regen-locked", (ctx) => ops.regenerateReportOp(ctx, { id: reportId, today: "2026-06-23" })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  // ----- cross-tenant isolation -----

  it("tenant B cannot see tenant A's reports", async () => {
    const { withTenant } = db.client;
    const { reports } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) => tx.select({ id: reports.id }).from(reports).where(eq(reports.id, reportId)));
    expect(seen).toHaveLength(0);
  });

  it("WITH CHECK blocks forging a report into another tenant", async () => {
    const { withTenant } = db.client;
    const { reports } = db.schema;
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(reports).values({ tenantId: tenantA, title: "forged", reportType: "custom" }),
      ),
    ).rejects.toThrow();
  });
});
