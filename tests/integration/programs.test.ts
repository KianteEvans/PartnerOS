import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Program Management end-to-end through the gate: adopt-from-library seeds the
 * requirement checklist, requirement -> task and requirement -> evidence
 * handoffs, the readiness-gated submission, and cross-tenant RLS.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/programs/operations");

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

let programId = "";
let reqIds: string[] = [];

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
  who = idA,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "program.test", resourceType: "program", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/programs/operations");

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
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = inserted.find((u) => u.sub === "owner-a")!.id;
    ownerB = inserted.find((u) => u.sub === "owner-b")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("programs end-to-end", () => {
  it("adopts a library program and seeds its requirements", async () => {
    const res = await run("program:create", "adopt", (ctx) =>
      ops.adoptProgramOp(ctx, { libraryKey: "isv_accelerate" }),
    );
    programId = res.body.id;
    expect(res.body.requirements).toBe(3);

    const { withTenant } = db.client;
    const { programs, programRequirements } = db.schema;
    const [p] = await withTenant(idA(), (tx) =>
      tx.select().from(programs).where(eq(programs.id, programId)),
    );
    expect(p!.name).toBe("ISV Accelerate");
    expect(p!.status).toBe("pending");

    const rows = await withTenant(idA(), (tx) =>
      tx.select().from(programRequirements).where(eq(programRequirements.programId, programId)),
    );
    reqIds = rows.map((r) => r.id);
    expect(reqIds).toHaveLength(3);
  });

  it("rejects adopting the same program twice", async () => {
    await expect(
      run("program:create", "adopt-dupe", (ctx) =>
        ops.adoptProgramOp(ctx, { libraryKey: "isv_accelerate" }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("rejects adoption by a viewer", async () => {
    await expect(
      run(
        "program:create",
        "adopt-viewer",
        (ctx) => ops.adoptProgramOp(ctx, { libraryKey: "security_competency" }),
        () => identity(tenantA, ownerA, "viewer"),
      ),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("creates a task from a requirement (idempotent) and validates owners", async () => {
    const first = await run("program:update", "req-task", (ctx) =>
      ops.createTaskFromRequirementOp(ctx, { requirementId: reqIds[0]! }),
    );
    expect(first.body.taskId).not.toBeNull();
    const second = await run("program:update", "req-task-2", (ctx) =>
      ops.createTaskFromRequirementOp(ctx, { requirementId: reqIds[0]! }),
    );
    expect(second.body.taskId).toBeNull(); // idempotent: no duplicate

    const { withTenant } = db.client;
    const { tasks, programRequirements } = db.schema;
    const programTasks = await withTenant(idA(), (tx) =>
      tx.select().from(tasks).where(eq(tasks.source, "program")),
    );
    expect(programTasks).toHaveLength(1);
    const [req] = await withTenant(idA(), (tx) =>
      tx.select().from(programRequirements).where(eq(programRequirements.id, reqIds[0]!)),
    );
    expect(req!.taskId).toBe(programTasks[0]!.id);

    await expect(
      run("program:update", "req-badowner", (ctx) =>
        ops.updateRequirementOp(ctx, { requirementId: reqIds[0]!, ownerUserId: ownerB }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("blocks submission until every requirement is met with approved evidence", async () => {
    await expect(
      run("program:submit", "submit-early", (ctx) =>
        ops.submitProgramOp(ctx, { programId, today: "2026-06-23" }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    // For each requirement: stage evidence, approve it, mark the requirement met.
    const { withTenant } = db.client;
    const { evidence, programRequirements } = db.schema;
    for (let i = 0; i < reqIds.length; i++) {
      const reqId = reqIds[i]!;
      const staged = await run("program:update", `stage-${i}`, (ctx) =>
        ops.stageEvidenceForRequirementOp(ctx, { requirementId: reqId }),
      );
      expect(staged.body.evidenceId).not.toBeNull();
      // approve the staged evidence (tenant-scoped write)
      await withTenant(idA(), (tx) =>
        tx.update(evidence).set({ status: "approved" }).where(eq(evidence.id, staged.body.evidenceId!)),
      );
      await run("program:update", `met-${i}`, (ctx) =>
        ops.updateRequirementOp(ctx, { requirementId: reqId, status: "met" }),
      );
    }

    // staged evidence carries program provenance
    const staged = await withTenant(idA(), (tx) =>
      tx.select().from(evidence).where(eq(evidence.source, "program")),
    );
    expect(staged).toHaveLength(3);
    expect(staged.every((e) => e.program === "ISV Accelerate")).toBe(true);

    // requirements now all linked to evidence
    const linked = await withTenant(idA(), (tx) =>
      tx.select().from(programRequirements).where(and(eq(programRequirements.programId, programId), eq(programRequirements.tenantId, tenantA))),
    );
    expect(linked.every((r) => r.evidenceId !== null)).toBe(true);
  });

  it("submits once ready and records the receipt", async () => {
    const res = await run("program:submit", `submit-program:${programId}`, (ctx) =>
      ops.submitProgramOp(ctx, { programId, today: "2026-06-23" }),
    );
    expect(res.body.status).toBe("submitted");

    const { withTenant } = db.client;
    const { programs } = db.schema;
    const [p] = await withTenant(idA(), (tx) =>
      tx.select().from(programs).where(eq(programs.id, programId)),
    );
    expect(p!.status).toBe("submitted");
    expect(p!.submittedAt).not.toBeNull();

    // already submitted -> guarded
    await expect(
      run("program:submit", "submit-again", (ctx) =>
        ops.submitProgramOp(ctx, { programId, today: "2026-06-23" }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  // ----- cross-tenant isolation -----

  it("tenant B cannot see tenant A's programs", async () => {
    const { withTenant } = db.client;
    const { programs } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) => tx.select().from(programs));
    expect(seen).toHaveLength(0);
  });

  it("WITH CHECK blocks forging a program into another tenant", async () => {
    const { withTenant } = db.client;
    const { programs } = db.schema;
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(programs).values({
          tenantId: tenantA,
          libraryKey: "forged",
          name: "forged",
          programType: "x",
          deliveryModel: "x",
          fundingFit: "low",
        }),
      ),
    ).rejects.toThrow();
  });
});
