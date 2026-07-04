import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";
import type { CreateSubmissionInput } from "@/domain/funding/operations";

/**
 * AWS Funding submissions end-to-end through the gate: the lifecycle
 * (draft -> submitted -> in_review -> approved -> funded), the owner/admin-only
 * approval gate, the status guards, in-tenant opportunity linking, and
 * cross-tenant RLS isolation. Generic tracker — the MDF co-fund/claim machinery
 * lives in its own suite.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/funding/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let memberA = "";
let oppA = "";
let oppB = "";

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

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
  who = idA,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "funding.test", resourceType: "funding_submission", handler },
    { resolveIdentity: async () => who() },
  );
}

const baseInput = (over: Partial<CreateSubmissionInput> = {}): CreateSubmissionInput => ({
  programKey: "map",
  title: "MAP migration funding",
  fundingType: "cash",
  requestedAmount: 50_000,
  workloadType: "migration",
  customerSegment: "enterprise",
  opportunityId: null,
  deadline: "2026-09-01",
  externalRef: "MAP-1",
  ownerUserId: ownerA,
  ...over,
});

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/funding/operations");

  const { withSystem } = db.client;
  const { tenants, users, opportunities } = db.schema;
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

    const opps = await tx
      .insert(opportunities)
      .values([
        { tenantId: tenantA, name: "Globex migration", createdBy: ownerA },
        { tenantId: tenantB, name: "Other-tenant deal", createdBy: ownerB },
      ])
      .returning({ id: opportunities.id, tenantId: opportunities.tenantId });
    oppA = opps.find((o) => o.tenantId === tenantA)!.id;
    oppB = opps.find((o) => o.tenantId === tenantB)!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

let submissionId = "";

describe("funding submissions end-to-end", () => {
  it("rejects an owner or opportunity from another workspace at create time", async () => {
    await expect(
      run("funding:create", "create-foreign-owner", (ctx) => ops.createSubmissionOp(ctx, baseInput({ ownerUserId: ownerB }))),
    ).rejects.toBeInstanceOf(errors.ValidationError);
    await expect(
      run("funding:create", "create-foreign-opp", (ctx) => ops.createSubmissionOp(ctx, baseInput({ opportunityId: oppB }))),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("creates a draft linked to an in-tenant opportunity, then submits it", async () => {
    const created = await run("funding:create", "create", (ctx) => ops.createSubmissionOp(ctx, baseInput({ opportunityId: oppA })));
    submissionId = created.body.id;

    const res = await run("funding:submit", "submit", (ctx) => ops.submitSubmissionOp(ctx, { id: submissionId }));
    expect(res.body.status).toBe("submitted");

    const { withTenant } = db.client;
    const { fundingSubmissions } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(fundingSubmissions).where(eq(fundingSubmissions.id, submissionId)));
    expect(r!.status).toBe("submitted");
    expect(r!.opportunityId).toBe(oppA);
  });

  it("blocks editing once it has left draft", async () => {
    await expect(
      run("funding:update", "edit-nondraft", (ctx) => ops.updateSubmissionOp(ctx, { id: submissionId, requestedAmount: 1 })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("restricts approval to owner/admin and validates the amount", async () => {
    // A member cannot approve (lacks funding:approve).
    await expect(
      run("funding:approve", "approve-member", (ctx) => ops.approveSubmissionOp(ctx, { id: submissionId, approvedAmount: 50_000, notes: "" }), () => identity(tenantA, memberA, "member")),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);

    // Over-approving beyond the requested amount is rejected.
    await expect(
      run("funding:approve", "approve-over", (ctx) => ops.approveSubmissionOp(ctx, { id: submissionId, approvedAmount: 60_000, notes: "" })),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    const res = await run("funding:approve", "approve", (ctx) => ops.approveSubmissionOp(ctx, { id: submissionId, approvedAmount: 45_000, notes: "approved for phase 1" }));
    expect(res.body.status).toBe("approved");

    const { withTenant } = db.client;
    const { fundingSubmissions } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(fundingSubmissions).where(eq(fundingSubmissions.id, submissionId)));
    expect(r!.approvedAmount).toBe(45_000);
    expect(r!.decisionAt).not.toBeNull();
    expect(r!.decisionNotes).toBe("approved for phase 1");
  });

  it("marks the approved submission as funded, then guards out-of-order transitions", async () => {
    const res = await run("funding:approve", "fund", (ctx) => ops.markFundedOp(ctx, { id: submissionId }));
    expect(res.body.status).toBe("funded");

    // Funded is terminal — re-submitting or withdrawing again is rejected.
    await expect(
      run("funding:submit", "resubmit", (ctx) => ops.submitSubmissionOp(ctx, { id: submissionId })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
    await expect(
      run("funding:update", "withdraw-funded", (ctx) => ops.withdrawSubmissionOp(ctx, { id: submissionId })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("requires a requested amount before submitting", async () => {
    const created = await run("funding:create", "create-zero", (ctx) => ops.createSubmissionOp(ctx, baseInput({ requestedAmount: 0 })));
    await expect(
      run("funding:submit", "submit-zero", (ctx) => ops.submitSubmissionOp(ctx, { id: created.body.id })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("supports withdraw from draft and reject from in_review", async () => {
    const d = await run("funding:create", "create-wd", (ctx) => ops.createSubmissionOp(ctx, baseInput()));
    const wd = await run("funding:update", "withdraw", (ctx) => ops.withdrawSubmissionOp(ctx, { id: d.body.id }));
    expect(wd.body.status).toBe("withdrawn");

    const r = await run("funding:create", "create-rej", (ctx) => ops.createSubmissionOp(ctx, baseInput()));
    await run("funding:submit", "submit-rej", (ctx) => ops.submitSubmissionOp(ctx, { id: r.body.id }));
    await run("funding:approve", "review-rej", (ctx) => ops.startReviewOp(ctx, { id: r.body.id }));
    const rej = await run("funding:approve", "reject", (ctx) => ops.rejectSubmissionOp(ctx, { id: r.body.id, notes: "out of budget" }));
    expect(rej.body.status).toBe("rejected");
  });

  // ----- cross-tenant isolation -----

  it("tenant B cannot see tenant A's funding submissions", async () => {
    const { withTenant } = db.client;
    const { fundingSubmissions } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) => tx.select().from(fundingSubmissions));
    expect(seen).toHaveLength(0);
  });

  it("WITH CHECK blocks forging a submission into another tenant", async () => {
    const { withTenant } = db.client;
    const { fundingSubmissions } = db.schema;
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(fundingSubmissions).values({ tenantId: tenantA, programKey: "map", title: "forged" }),
      ),
    ).rejects.toThrow();
  });
});
