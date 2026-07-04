import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";
import type { Decision } from "@/domain/command/brief";

/**
 * Playbook engine end-to-end through the gate: the creator-permission pre-auth,
 * materialize-from-decisions with the automation-mode verdict, auto-execution of a
 * low-risk action, the approval queue for risky actions, the approve-within-cap
 * guardrail, and cross-tenant RLS.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/playbooks/operations");
let mdfOps: typeof import("@/domain/mdf/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let managerA = "";
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

async function run<T>(permission: Permission, key: string, handler: (ctx: MutationContext) => Promise<T>, who = idA) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "playbook.test", resourceType: "playbook", handler },
    { resolveIdentity: async () => who() },
  );
}

function decision(over: Partial<Decision> & { id: string; situation: Decision["situation"]; severity: Decision["severity"] }): Decision {
  return { title: "t", detail: "d", ownerUserId: ownerA, dueDate: null, link: "/x", ...over };
}

async function firstRunId(playbookId: string): Promise<{ id: string; status: string }> {
  const { withTenant } = db.client;
  const { playbookRuns } = db.schema;
  const [r] = await withTenant(idA(), (tx) => tx.select().from(playbookRuns).where(eq(playbookRuns.playbookId, playbookId)));
  return { id: r!.id, status: r!.status };
}

const TODAY = "2026-07-01";

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/playbooks/operations");
  mdfOps = await import("@/domain/mdf/operations");

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
        { tenantId: tenantA, oidcSubject: "manager-a", email: "manager@acme.test", role: "manager" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = inserted.find((u) => u.sub === "owner-a")!.id;
    managerA = inserted.find((u) => u.sub === "manager-a")!.id;
    ownerB = inserted.find((u) => u.sub === "owner-b")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("playbook engine end-to-end", () => {
  it("requires the creator to hold the action's base permission (pre-authorization)", async () => {
    // A manager has playbook:create but NOT mdf:approve, so cannot automate an approval.
    await expect(
      run(
        "playbook:create",
        "create-approve-mgr",
        (ctx) =>
          ops.createPlaybookOp(ctx, {
            name: "bad", description: "", enabled: true,
            triggerSituation: "mdf_deadline", triggerMinSeverity: "medium",
            actionType: "approve_within_cap", actionParams: { cap: 5000 }, channels: ["in_app"],
          }),
        () => identity(tenantA, managerA, "manager"),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("rejects an action that cannot respond to the chosen trigger", async () => {
    await expect(
      run("playbook:create", "create-mismatch", (ctx) =>
        ops.createPlaybookOp(ctx, {
          name: "mismatch", description: "", enabled: true,
          triggerSituation: "overdue_work", triggerMinSeverity: "medium",
          actionType: "route_opportunity", actionParams: {}, channels: ["in_app"],
        }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("auto-executes a low-risk notify and persists a de-duplicated notification", async () => {
    const created = await run("playbook:create", "create-notify", (ctx) =>
      ops.createPlaybookOp(ctx, {
        name: "Notify funding", description: "", enabled: true,
        triggerSituation: "funding_deadline", triggerMinSeverity: "medium",
        actionType: "notify", actionParams: {}, channels: ["in_app"],
      }),
    );
    const pbId = created.body.id;
    const decisions = [decision({ id: "funding-1", situation: "funding_deadline", severity: "high" })];

    const res = await run("playbook:run", "mat-notify", (ctx) => ops.materializePlaybookRunsOp(ctx, { decisions, mode: "auto_with_approval", today: TODAY }));
    expect(res.body.created).toBe(1);
    expect(res.body.executed).toBe(1); // in_app notify is low-risk -> auto

    const run1 = await firstRunId(pbId);
    expect(run1.status).toBe("executed");

    const { withTenant } = db.client;
    const { notifications } = db.schema;
    const notes = await withTenant(idA(), (tx) => tx.select().from(notifications).where(eq(notifications.dedupeKey, `${pbId}:funding-1`)));
    expect(notes).toHaveLength(1);

    // Re-materializing the same decision does not fire again (fire-once).
    const again = await run("playbook:run", "mat-notify-2", (ctx) => ops.materializePlaybookRunsOp(ctx, { decisions, mode: "auto_with_approval", today: TODAY }));
    expect(again.body.created).toBe(0);
  });

  it("queues a medium-risk task action for approval, then executes it on approve", async () => {
    const created = await run("playbook:create", "create-task-pb", (ctx) =>
      ops.createPlaybookOp(ctx, {
        name: "Task on overdue", description: "", enabled: true,
        triggerSituation: "overdue_work", triggerMinSeverity: "high",
        actionType: "create_task", actionParams: { priority: "high" }, channels: ["in_app"],
      }),
    );
    const pbId = created.body.id;
    const decisions = [decision({ id: "task-overdue-x", situation: "overdue_work", severity: "critical", title: "Ship the deck" })];

    const res = await run("playbook:run", "mat-task", (ctx) => ops.materializePlaybookRunsOp(ctx, { decisions, mode: "auto_with_approval", today: TODAY }));
    expect(res.body.pending).toBe(1); // create_task is medium -> approval
    const runRow = await firstRunId(pbId);
    expect(runRow.status).toBe("pending_approval");

    await run("playbook:approve", "approve-task", (ctx) => ops.approveRunOp(ctx, { runId: runRow.id, today: TODAY }));

    const { withTenant } = db.client;
    const { tasks, playbookRuns } = db.schema;
    const created2 = await withTenant(idA(), (tx) => tx.select().from(tasks).where(eq(tasks.title, "Follow up: Ship the deck")));
    expect(created2.length).toBeGreaterThanOrEqual(1);
    const [after] = await withTenant(idA(), (tx) => tx.select().from(playbookRuns).where(eq(playbookRuns.id, runRow.id)));
    expect(after!.status).toBe("executed");
  });

  it("approves an MDF request within the cap and fails one over the cap", async () => {
    // Two MDF requests submitted to the 'requested' state: one under, one over the cap.
    const mk = async (key: string, amount: number): Promise<string> => {
      const c = await run("mdf:create", `mk-${key}`, (ctx) =>
        mdfOps.createRequestOp(ctx, {
          title: `req ${key}`, activityType: "event", requestedAmount: amount, expectedPipeline: amount * 5,
          ownerUserId: ownerA, startDate: "2026-07-15", endDate: "2026-07-20", claimDeadline: "2026-09-01", opportunityRef: "OPP-1",
        }),
      );
      await run("mdf:update", `sub-${key}`, (ctx) => mdfOps.submitRequestOp(ctx, { id: c.body.id, today: TODAY }));
      return c.body.id;
    };
    const under = await mk("under", 4000);
    const over = await mk("over", 9000);

    const created = await run("playbook:create", "create-approve-pb", (ctx) =>
      ops.createPlaybookOp(ctx, {
        name: "Approve small MDF", description: "", enabled: true,
        triggerSituation: "mdf_deadline", triggerMinSeverity: "medium",
        actionType: "approve_within_cap", actionParams: { cap: 5000 }, channels: ["in_app"],
      }),
    );
    const pbId = created.body.id;
    const decisions = [
      decision({ id: `mdf-${under}`, situation: "mdf_deadline", severity: "high" }),
      decision({ id: `mdf-${over}`, situation: "mdf_deadline", severity: "high" }),
    ];
    await run("playbook:run", "mat-approve", (ctx) => ops.materializePlaybookRunsOp(ctx, { decisions, mode: "auto_with_approval", today: TODAY }));

    const { withTenant } = db.client;
    const { playbookRuns, mdfRequests } = db.schema;
    const runs = await withTenant(idA(), (tx) => tx.select().from(playbookRuns).where(eq(playbookRuns.playbookId, pbId)));
    for (const r of runs) {
      await run("playbook:approve", `ap-${r.id}`, (ctx) => ops.approveRunOp(ctx, { runId: r.id, today: TODAY })).catch(() => undefined);
    }
    const [underReq] = await withTenant(idA(), (tx) => tx.select().from(mdfRequests).where(eq(mdfRequests.id, under)));
    const [overReq] = await withTenant(idA(), (tx) => tx.select().from(mdfRequests).where(eq(mdfRequests.id, over)));
    expect(underReq!.status).toBe("approved");
    expect(underReq!.approvedAmount).toBe(4000);
    expect(overReq!.status).toBe("requested"); // over the cap -> not approved
  });

  // ----- cross-tenant isolation -----

  it("tenant B cannot see tenant A's playbooks; WITH CHECK blocks forging", async () => {
    const { withTenant } = db.client;
    const { playbooks } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) => tx.select().from(playbooks));
    expect(seen).toHaveLength(0);
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(playbooks).values({ tenantId: tenantA, name: "forged", triggerSituation: "overdue_work", actionType: "notify" }),
      ),
    ).rejects.toThrow();
  });
});
