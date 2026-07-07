import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Agency / portfolio mode (Bet C). Verifies cross-workspace aggregation, the
 * consent-based link approval (which provisions the agency service user), and —
 * the security crux — the authorization boundary: an agency can only read/act on a
 * workspace whose agency_id points back at it.
 */

let db: TestDb;
let load: typeof import("@/domain/portfolio/load");
let ops: typeof import("@/domain/portfolio/operations");
let agency: typeof import("@/auth/agency");

const A = "aaaaaaaa-0000-0000-0000-000000000001"; // agency A
const B = "bbbbbbbb-0000-0000-0000-000000000002"; // agency B
const C1 = "cccccccc-0000-0000-0000-000000000011"; // managed by A
const C2 = "cccccccc-0000-0000-0000-000000000012"; // managed by A
const C3 = "cccccccc-0000-0000-0000-000000000013"; // managed by B
const U = "dddddddd-0000-0000-0000-000000000004"; // independent

let ownerA = "";
let ownerB = "";
let ownerU = "";

const id = (tenantId: string, userId: string) =>
  ({ tenantId, userId, role: "owner", oidcSubject: "o", email: "o@x.test", epoch: 0 }) as const;

beforeAll(async () => {
  db = await setupTestDb();
  load = await import("@/domain/portfolio/load");
  ops = await import("@/domain/portfolio/operations");
  agency = await import("@/auth/agency");
  const { withSystem } = db.client;
  const { tenants, users, agencyLinkRequests } = db.schema;

  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: A, name: "Agency A", slug: "agency-a", isAgency: true },
      { id: B, name: "Agency B", slug: "agency-b", isAgency: true },
      { id: C1, name: "North Cloud", slug: "north-cloud", agencyId: A, tier: "advanced" },
      { id: C2, name: "Initech", slug: "initech", agencyId: A, tier: "select" },
      { id: C3, name: "Hooli", slug: "hooli", agencyId: B },
      { id: U, name: "Vandelay", slug: "vandelay" },
    ]);
    const us = await tx
      .insert(users)
      .values([
        { tenantId: A, oidcSubject: "owner-a", email: "owner@a.test", role: "owner" },
        { tenantId: B, oidcSubject: "owner-b", email: "owner@b.test", role: "owner" },
        { tenantId: U, oidcSubject: "owner-u", email: "owner@u.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = us.find((u) => u.sub === "owner-a")!.id;
    ownerB = us.find((u) => u.sub === "owner-b")!.id;
    ownerU = us.find((u) => u.sub === "owner-u")!.id;
    // Pending request: agency B asks to manage the independent workspace U.
    await tx.insert(agencyLinkRequests).values({
      agencyTenantId: B,
      targetTenantId: U,
      requestedBy: ownerB,
      status: "pending",
    });
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("portfolio aggregation", () => {
  it("an agency sees only its own managed workspaces", async () => {
    const view = await load.loadPortfolio(id(A, ownerA));
    expect(view.isAgency).toBe(true);
    expect(view.total).toBe(2);
    const ids = view.workspaces.map((w) => w.id).sort();
    expect(ids).toEqual([C1, C2].sort());
    for (const w of view.workspaces) {
      expect(typeof w.health).toBe("number");
    }
    expect(view.rollup.count).toBe(2);
  });

  it("a non-agency workspace has no portfolio", async () => {
    const view = await load.loadPortfolio(id(U, ownerU));
    expect(view.isAgency).toBe(false);
    expect(view.workspaces).toHaveLength(0);
  });
});

describe("authorization boundary (security crux)", () => {
  it("loadManagedWorkspace allows a managed workspace and rejects an unmanaged one", async () => {
    expect(await load.loadManagedWorkspace(id(A, ownerA), C1)).not.toBeNull();
    // C3 is managed by agency B, not A -> A must not be able to read it.
    expect(await load.loadManagedWorkspace(id(A, ownerA), C3)).toBeNull();
    // U is independent -> not managed by anyone.
    expect(await load.loadManagedWorkspace(id(A, ownerA), U)).toBeNull();
  });

  it("assertManages throws for a workspace the agency does not manage", async () => {
    await expect(agency.assertManages(A, C1)).resolves.toBeUndefined();
    await expect(agency.assertManages(A, C3)).rejects.toThrow();
  });
});

describe("link consent", () => {
  it("approving a request sets agency_id + provisions the service user", async () => {
    const { withSystem, withTenant } = db.client;
    const { agencyLinkRequests, tenants, users } = db.schema;
    const [req] = await withSystem((tx) =>
      tx.select().from(agencyLinkRequests).where(eq(agencyLinkRequests.targetTenantId, U)),
    );
    expect(req).toBeTruthy();

    // The TARGET owner (U) approves inside their own tenant tx.
    await withTenant(id(U, ownerU), (tx) =>
      ops.approveLinkOp({ identity: id(U, ownerU) as never, tx }, { requestId: req!.id }),
    );

    const after = await withSystem(async (tx) => {
      const [t] = await tx.select({ agencyId: tenants.agencyId }).from(tenants).where(eq(tenants.id, U));
      const svc = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(and(eq(users.tenantId, U), eq(users.oidcSubject, `agency:${B}`)));
      const [reqAfter] = await tx.select({ status: agencyLinkRequests.status }).from(agencyLinkRequests).where(eq(agencyLinkRequests.id, req!.id));
      return { agencyId: t?.agencyId, svc, status: reqAfter?.status };
    });
    expect(after.agencyId).toBe(B);
    expect(after.svc).toHaveLength(1);
    expect(after.svc[0]!.role).toBe("admin");
    expect(after.status).toBe("approved");

    // Now B manages U — it can read it; A still cannot.
    expect(await load.loadManagedWorkspace(id(B, ownerB), U)).not.toBeNull();
    expect(await load.loadManagedWorkspace(id(A, ownerA), U)).toBeNull();
  });

  it("a tenant cannot approve a request that does not target it", async () => {
    const { withSystem, withTenant } = db.client;
    const { agencyLinkRequests, tenants } = db.schema;
    // Fresh pending request B -> C1... but C1 is already managed; use a new independent target.
    const T = "dddddddd-0000-0000-0000-000000000009";
    await withSystem(async (tx) => {
      await tx.insert(tenants).values({ id: T, name: "Target", slug: "target-x" });
      await tx.insert(agencyLinkRequests).values({ agencyTenantId: B, targetTenantId: T, requestedBy: ownerB, status: "pending" });
    });
    const [req] = await withSystem((tx) =>
      tx.select().from(agencyLinkRequests).where(eq(agencyLinkRequests.targetTenantId, T)),
    );
    // Agency A tries to approve a request targeting T (not A) -> the row is invisible under
    // A's RLS, so the op finds no pending request and throws.
    await expect(
      withTenant(id(A, ownerA), (tx) =>
        ops.approveLinkOp({ identity: id(A, ownerA) as never, tx }, { requestId: req!.id }),
      ),
    ).rejects.toThrow();
  });
});

describe("invite-on-create (agency onboarding)", () => {
  it("seeds de-duplicated pending invitations for the new customer workspace", async () => {
    const { withSystem } = db.client;
    const { invitations, users } = db.schema;
    const res = await ops.createManagedWorkspaceOp({ identity: id(A, ownerA) } as never, {
      name: "New Security Inc",
      initialUsers: [
        { email: "lead@newsec.test", role: "admin" },
        { email: "LEAD@newsec.test", role: "member" }, // same email (case) -> collapsed
        { email: "ops@newsec.test", role: "viewer" },
      ],
    });
    expect(res.invited).toHaveLength(2);

    const rows = await withSystem((tx) =>
      tx
        .select({
          email: invitations.email,
          role: invitations.role,
          status: invitations.status,
          invitedBy: invitations.invitedByUserId,
        })
        .from(invitations)
        .where(eq(invitations.tenantId, res.tenantId)),
    );
    expect(rows).toHaveLength(2);
    const byEmail = new Map(rows.map((r) => [r.email, r]));
    expect(byEmail.get("lead@newsec.test")?.status).toBe("pending");
    expect(byEmail.get("ops@newsec.test")?.role).toBe("viewer");
    // "Invited by" is the agency service user provisioned in the CHILD workspace.
    const svc = await withSystem((tx) =>
      tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, res.tenantId), eq(users.oidcSubject, `agency:${A}`))),
    );
    expect(svc).toHaveLength(1);
    expect(byEmail.get("lead@newsec.test")?.invitedBy).toBe(svc[0]!.id);
  });

  it("creates no invitations when none are provided", async () => {
    const { withSystem } = db.client;
    const { invitations } = db.schema;
    const res = await ops.createManagedWorkspaceOp({ identity: id(A, ownerA) } as never, {
      name: "Empty Co",
    });
    const rows = await withSystem((tx) =>
      tx.select({ id: invitations.id }).from(invitations).where(eq(invitations.tenantId, res.tenantId)),
    );
    expect(rows).toHaveLength(0);
  });
});
