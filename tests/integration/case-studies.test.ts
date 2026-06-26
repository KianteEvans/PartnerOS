import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Case Studies end-to-end through the gate: create + update the narrative aspects
 * (completeness rolls up), and cross-tenant RLS isolation.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/case-studies/operations");
let load: typeof import("@/domain/case-studies/load");

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
const idA = () => identity(tenantA, ownerA);
const idB = () => identity(tenantB, ownerB);

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
  who = idA,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "case_study.test", resourceType: "case_study", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/case-studies/operations");
  load = await import("@/domain/case-studies/load");

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

let csId = "";

describe("case studies", () => {
  it("creates a case study", async () => {
    const res = await run("case_study:create", "cs-create", (ctx) =>
      ops.createCaseStudyOp(ctx, {
        title: "Acme EKS security",
        customerName: "Acme University",
        visibility: "public",
        anonymized: false,
        evidenceId: null,
      }),
    );
    csId = res.body.id;
    expect(csId).toBeTruthy();
    const items = await load.loadCaseStudies(idA());
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Acme EKS security");
    expect(items[0]!.visibility).toBe("public");
    expect(items[0]!.filled).toBe(0); // no narrative yet
  });

  it("updates the narrative aspects and completeness rolls up", async () => {
    await run("case_study:update", "cs-update", (ctx) =>
      ops.updateCaseStudyOp(ctx, {
        caseStudyId: csId,
        aboutCustomer: "A public university system.",
        challenge: "Security gaps across clusters.",
        goals: "Harden EKS secrets management.",
        solution: "Implemented centralized controls on AWS.",
        outcomes: "Reduced risk and passed audit.",
      }),
    );
    const detail = await load.loadCaseStudyDetail(idA(), csId);
    expect(detail!.aboutCustomer).toBe("A public university system.");
    expect(detail!.outcomes).toBe("Reduced risk and passed audit.");
    const items = await load.loadCaseStudies(idA());
    expect(items[0]!.filled).toBe(5);
  });

  it("attaches/detaches a case study to an application (ordered, idempotent)", async () => {
    const { withSystem, withTenant } = db.client;
    const { competencyApplications, applicationCaseStudies } = db.schema;
    let appId = "";
    await withSystem(async (tx) => {
      const [a] = await tx
        .insert(competencyApplications)
        .values({ tenantId: tenantA, name: "Sec App", competency: "Security", programType: "Competency", controlCount: 0 })
        .returning({ id: competencyApplications.id });
      appId = a!.id;
    });

    await run("application:update", "cs-attach", (ctx) => ops.attachCaseStudyOp(ctx, { applicationId: appId, caseStudyId: csId }));
    const rows = await withTenant(idA(), (tx) =>
      tx.select().from(applicationCaseStudies).where(eq(applicationCaseStudies.applicationId, appId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.caseStudyId).toBe(csId);
    expect(rows[0]!.sequence).toBe(0);

    // Re-attaching the same case study is a no-op (unique constraint + onConflictDoNothing).
    await run("application:update", "cs-attach-2", (ctx) => ops.attachCaseStudyOp(ctx, { applicationId: appId, caseStudyId: csId }));
    const again = await withTenant(idA(), (tx) =>
      tx.select().from(applicationCaseStudies).where(eq(applicationCaseStudies.applicationId, appId)),
    );
    expect(again).toHaveLength(1);

    // The application loader reflects the attached count + ordering.
    const appLoad = await import("@/domain/applications/load");
    const detail = await appLoad.loadApplicationDetail(idA(), appId);
    expect(detail!.caseStudyCount).toBe(1);
    expect(detail!.attachedCaseStudies[0]!.id).toBe(csId);

    await run("application:update", "cs-detach", (ctx) => ops.detachCaseStudyOp(ctx, { applicationId: appId, caseStudyId: csId }));
    const after = await withTenant(idA(), (tx) =>
      tx.select().from(applicationCaseStudies).where(eq(applicationCaseStudies.applicationId, appId)),
    );
    expect(after).toHaveLength(0);
  });

  it("isolates tenants (RLS)", async () => {
    expect(await load.loadCaseStudies(idB())).toHaveLength(0);
    expect(await load.loadCaseStudyDetail(idB(), csId)).toBeNull();
    await expect(
      run("case_study:update", "cs-update-b", (ctx) => ops.updateCaseStudyOp(ctx, { caseStudyId: csId, title: "hacked" }), idB),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });
});
