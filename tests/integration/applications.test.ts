import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";
import type { Control } from "@/domain/applications/grid";

/**
 * Competency Application end-to-end through the gate: create-from-upload persists
 * the parent + controls + a storage_objects row; control accept rolls a count up
 * onto the parent (draft -> ready); permission gating; not-found; cross-tenant RLS
 * on both tables; markExported. The live Claude call is not exercised.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/applications/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let viewerA = "";
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
    { permission, idempotencyKey: key, rawBody: "{}", action: "application.test", resourceType: "application", handler },
    { resolveIdentity: async () => who() },
  );
}

const CONTROLS: Control[] = [
  { id: "GEN-001", requirement: "Security CI/CD", section: "Overview", sheetName: "Security", rowIndex: 4, responseTargets: [{ metAddress: "C5", responseAddress: "D5" }] },
  { id: "GEN-002", requirement: "Infrastructure as Code", section: "Overview", sheetName: "Security", rowIndex: 5, responseTargets: [{ metAddress: "C6", responseAddress: "D6" }] },
  { id: "POV-001", requirement: "Customer Presentation", section: "Overview", sheetName: "Common", rowIndex: 4, responseTargets: [{ metAddress: "C5", responseAddress: "D5" }] },
];

let appId = "";

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/applications/operations");

  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const inserted = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" },
        { tenantId: tenantA, oidcSubject: "viewer-a", email: "viewer@acme.test", role: "viewer" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = inserted.find((u) => u.sub === "owner-a")!.id;
    viewerA = inserted.find((u) => u.sub === "viewer-a")!.id;
    ownerB = inserted.find((u) => u.sub === "owner-b")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("competency applications", () => {
  it("create-from-upload persists the parent, controls, and a storage object", async () => {
    const res = await run("application:create", "app-create", (ctx) =>
      ops.createApplicationFromUploadOp(ctx, {
        name: "Security 2026",
        competency: "Security Competency",
        programType: "Competency",
        fileName: "security.xlsx",
        bytes: new Uint8Array([1, 2, 3, 4]),
        controls: CONTROLS,
      }),
    );
    appId = res.body.id;
    expect(res.body.controls).toBe(3);

    const { withTenant } = db.client;
    const { competencyApplications, applicationControls, storageObjects } = db.schema;
    const [app] = await withTenant(idA(), (tx) =>
      tx.select().from(competencyApplications).where(eq(competencyApplications.id, appId)),
    );
    expect(app!.status).toBe("draft");
    expect(app!.programType).toBe("Competency");
    expect(app!.controlCount).toBe(3);
    expect(app!.sourceStorageObjectId).toBeTruthy();

    const ctrls = await withTenant(idA(), (tx) =>
      tx
        .select({ controlId: applicationControls.controlId, status: applicationControls.status, sheet: applicationControls.sheetName })
        .from(applicationControls)
        .where(eq(applicationControls.applicationId, appId)),
    );
    expect(ctrls).toHaveLength(3);
    expect(ctrls.every((c) => c.status === "open")).toBe(true);
    expect(new Set(ctrls.map((c) => c.controlId))).toEqual(new Set(["GEN-001", "GEN-002", "POV-001"]));

    const objs = await withTenant(idA(), (tx) =>
      tx.select({ id: storageObjects.id }).from(storageObjects).where(eq(storageObjects.tenantId, tenantA)),
    );
    expect(objs.length).toBeGreaterThan(0);
  });

  it("accepting all controls rolls the count up and flips the parent to ready", async () => {
    const { withTenant } = db.client;
    const { applicationControls, competencyApplications } = db.schema;
    const ctrls = await withTenant(idA(), (tx) =>
      tx.select({ id: applicationControls.id }).from(applicationControls).where(eq(applicationControls.applicationId, appId)),
    );
    let i = 0;
    for (const c of ctrls) {
      i += 1;
      await run("application:update", `accept-${i}`, (ctx) =>
        ops.updateControlOp(ctx, { controlId: c.id, response: "We do X.", met: "yes", status: "accepted" }),
      );
    }
    const [app] = await withTenant(idA(), (tx) =>
      tx.select().from(competencyApplications).where(eq(competencyApplications.id, appId)),
    );
    expect(app!.acceptedCount).toBe(3);
    expect(app!.status).toBe("ready");
  });

  it("updates packet metadata + AWS status, stamping milestone dates", async () => {
    const { withTenant } = db.client;
    const { competencyApplications } = db.schema;
    await run("application:update", "pkt-1", (ctx) =>
      ops.updateApplicationOp(ctx, {
        applicationId: appId,
        categories: "Threat Detection and Response",
        pocName: "Jordan",
        pocEmail: "jordan@acme.test",
        pocRole: "Alliance Lead",
        awsStatus: "submitted",
      }),
    );
    const [a1] = await withTenant(idA(), (tx) =>
      tx.select().from(competencyApplications).where(eq(competencyApplications.id, appId)),
    );
    expect(a1!.categories).toBe("Threat Detection and Response");
    expect(a1!.pocName).toBe("Jordan");
    expect(a1!.awsStatus).toBe("submitted");
    expect(a1!.submittedAt).toBeTruthy();
    expect(a1!.confirmedAt).toBeNull();

    // Advancing to confirmed stamps confirmed_at and preserves submitted_at (COALESCE).
    const submittedAt = a1!.submittedAt;
    await run("application:update", "pkt-2", (ctx) =>
      ops.updateApplicationOp(ctx, { applicationId: appId, awsStatus: "confirmed" }),
    );
    const [a2] = await withTenant(idA(), (tx) =>
      tx.select().from(competencyApplications).where(eq(competencyApplications.id, appId)),
    );
    expect(a2!.awsStatus).toBe("confirmed");
    expect(a2!.confirmedAt).toBeTruthy();
    expect(a2!.submittedAt).toEqual(submittedAt);
  });

  it("rejects a viewer creating an application", async () => {
    await expect(
      run(
        "application:create",
        "app-viewer",
        (ctx) =>
          ops.createApplicationFromUploadOp(ctx, {
            name: "x",
            competency: "",
            programType: "",
            fileName: "x.xlsx",
            bytes: new Uint8Array([1]),
            controls: CONTROLS,
          }),
        () => identity(tenantA, viewerA, "viewer"),
      ),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("rejects updating a control that does not exist", async () => {
    await expect(
      run("application:update", "missing-ctrl", (ctx) =>
        ops.updateControlOp(ctx, { controlId: "00000000-0000-0000-0000-000000000000", status: "accepted" }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("marks an application exported", async () => {
    const { withTenant } = db.client;
    const { competencyApplications } = db.schema;
    await run("application:update", "mark-exp", (ctx) => ops.markExportedOp(ctx, { applicationId: appId }));
    const [app] = await withTenant(idA(), (tx) =>
      tx.select().from(competencyApplications).where(eq(competencyApplications.id, appId)),
    );
    expect(app!.status).toBe("exported");
    expect(app!.exportedAt).toBeTruthy();
  });

  it("isolates tenants (RLS) on both tables", async () => {
    const { withTenant } = db.client;
    const { competencyApplications, applicationControls } = db.schema;
    const apps = await withTenant(idB(), (tx) =>
      tx.select().from(competencyApplications).where(eq(competencyApplications.tenantId, tenantA)),
    );
    expect(apps).toHaveLength(0);
    const ctrls = await withTenant(idB(), (tx) =>
      tx.select().from(applicationControls).where(eq(applicationControls.applicationId, appId)),
    );
    expect(ctrls).toHaveLength(0);
    // WITH CHECK blocks a forged cross-tenant insert.
    await expect(
      withTenant(idB(), (tx) =>
        tx.insert(competencyApplications).values({ tenantId: tenantA, name: "forged", controlCount: 0 }),
      ),
    ).rejects.toBeTruthy();
  });
});
