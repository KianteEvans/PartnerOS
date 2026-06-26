import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";
import type { SyncedOppTeam } from "@/domain/aws/sales-org";

/**
 * AWS Sales-Org sync end-to-end through the gate (AWS is never called — we feed
 * hand-built SyncedOppTeam rows, the shape the action produces from the API). Covers:
 * promote opp + dedup contacts by email + junction with titles + primary awsContactId;
 * dedup/clobber-guard idempotency on re-sync; per-rep rollups + coverage gaps; RLS.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let salesOrg: typeof import("@/domain/aws/sales-org");
let rollupsMod: typeof import("@/domain/ace/sales-org");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";

function identity(tenantId: string, userId: string) {
  return { tenantId, userId, oidcSubject: `sub-${userId}`, epoch: 0, email: `${userId}@t`, role: "owner" as const };
}
const idA = () => identity(tenantA, ownerA);
const idB = () => identity(tenantB, "00000000-0000-0000-0000-0000000000b0");

function runAs<T>(permission: Permission, key: string, handler: (ctx: MutationContext) => Promise<T>) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "aws.sales_org.test", resourceType: "aws_connection", handler },
    { resolveIdentity: async () => idA() },
  );
}

const SYNC: SyncedOppTeam[] = [
  {
    externalId: "AWS-1",
    mirror: { externalId: "AWS-1", name: "Acme", accountName: "Acme", stage: "business_validation", status: "open", amount: 100_000, awsStageRaw: "Business Validation" },
    team: [
      { email: "jane@amazon.com", name: "Jane Patel", title: "aws_sales_rep", role: "seller" },
      { email: "sam@amazon.com", name: "Sam Lee", title: "psm", role: "partner_manager" },
    ],
    engagementScore: "High",
    nextBestActions: "Schedule EBC",
  },
  {
    externalId: "AWS-2",
    mirror: { externalId: "AWS-2", name: "Globex", accountName: "Globex", stage: "prospect", status: "open", amount: 30_000, awsStageRaw: "Prospect" },
    team: [{ email: "sam@amazon.com", name: "Sam Lee", title: "psm", role: "partner_manager" }], // PSM only -> gap
    engagementScore: "",
    nextBestActions: "",
  },
];

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  salesOrg = await import("@/domain/aws/sales-org");
  rollupsMod = await import("@/domain/ace/sales-org");

  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme-so" },
      { id: tenantB, name: "Globex", slug: "globex-so" },
    ]);
    const [u] = await tx
      .insert(users)
      .values({ tenantId: tenantA, oidcSubject: "owner-a-so", email: "owner@a.test", role: "owner" })
      .returning({ id: users.id });
    ownerA = u!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

const all = <T>(fn: (tx: Parameters<Parameters<TestDb["client"]["withTenant"]>[1]>[0]) => Promise<T>) =>
  db.client.withTenant(idA(), fn);

describe("AWS Sales-Org sync", () => {
  it("promotes opps, dedups contacts by email, links the junction, sets the primary contact", async () => {
    await runAs("ace:update", "so-1", (ctx) => salesOrg.syncAwsSalesOrgOp(ctx, SYNC));
    const { opportunities, aceRelationships, opportunityAwsTeam } = db.schema;

    const opps = await all((tx) => tx.select().from(opportunities).where(eq(opportunities.tenantId, tenantA)));
    expect(opps).toHaveLength(2);
    const oppX = opps.find((o) => o.externalId === "AWS-1")!;
    expect(oppX.source).toBe("amazon_originated");
    expect(oppX.awsEngagementScore).toBe("High");

    const rels = await all((tx) => tx.select().from(aceRelationships).where(eq(aceRelationships.tenantId, tenantA)));
    expect(rels).toHaveLength(2); // sam appears on both opps -> one row
    const jane = rels.find((r) => r.email === "jane@amazon.com")!;
    const sam = rels.find((r) => r.email === "sam@amazon.com")!;
    expect(jane.role).toBe("seller");
    expect(sam.role).toBe("partner_manager");
    expect(oppX.awsContactId).toBe(jane.id); // sales rep is the primary contact

    const edges = await all((tx) => tx.select().from(opportunityAwsTeam).where(eq(opportunityAwsTeam.tenantId, tenantA)));
    expect(edges).toHaveLength(3); // X-jane, X-sam, Y-sam
  });

  it("is idempotent on re-sync (no dupes) and never clobbers user-owned columns", async () => {
    const { opportunities, aceRelationships, opportunityAwsTeam } = db.schema;
    const [oppX] = await all((tx) =>
      tx.select().from(opportunities).where(eq(opportunities.externalId, "AWS-1")),
    );
    // A user routes the deal + sets a next step.
    await db.client.withSystem((tx) =>
      tx.update(opportunities).set({ ownerUserId: ownerA, nextStep: "call the AE" }).where(eq(opportunities.id, oppX!.id)),
    );

    await runAs("ace:update", "so-2", (ctx) => salesOrg.syncAwsSalesOrgOp(ctx, SYNC));

    const opps = await all((tx) => tx.select().from(opportunities).where(eq(opportunities.tenantId, tenantA)));
    const rels = await all((tx) => tx.select().from(aceRelationships).where(eq(aceRelationships.tenantId, tenantA)));
    const edges = await all((tx) => tx.select().from(opportunityAwsTeam).where(eq(opportunityAwsTeam.tenantId, tenantA)));
    expect(opps).toHaveLength(2);
    expect(rels).toHaveLength(2);
    expect(edges).toHaveLength(3);
    const oppX2 = opps.find((o) => o.externalId === "AWS-1")!;
    expect(oppX2.ownerUserId).toBe(ownerA); // survived re-sync
    expect(oppX2.nextStep).toBe("call the AE");
  });

  it("computes per-rep rollups + coverage gaps from the synced rows", async () => {
    const { opportunities, aceRelationships, opportunityAwsTeam } = db.schema;
    const opps = await all((tx) => tx.select().from(opportunities).where(eq(opportunities.tenantId, tenantA)));
    const rels = await all((tx) => tx.select().from(aceRelationships).where(eq(aceRelationships.tenantId, tenantA)));
    const edges = await all((tx) => tx.select().from(opportunityAwsTeam).where(eq(opportunityAwsTeam.tenantId, tenantA)));

    const edgeRows = edges.map((e) => ({ opportunityId: e.opportunityId, relationshipId: e.relationshipId, title: e.title }));
    const oppRows = opps.map((o) => ({ id: o.id, accountName: o.accountName, status: o.status, amount: o.amount }));

    const rollups = rollupsMod.repRollups(
      rels.map((r) => ({ id: r.id, name: r.name, email: r.email, accountName: r.accountName })),
      edgeRows,
      oppRows,
      [],
    );
    expect(rollups.find((r) => r.email === "jane@amazon.com")!.openCount).toBe(1);
    const sam = rollups.find((r) => r.email === "sam@amazon.com")!;
    expect(sam.openCount).toBe(2); // on both deals
    expect(sam.openTCV).toBe(130_000);

    const gaps = rollupsMod.coverageGaps(oppRows, edgeRows);
    const globex = gaps.find((g) => g.account === "Globex")!;
    expect(globex.missingSalesRep).toBe(true);
    expect(globex.missingPsm).toBe(false);
  });

  it("isolates tenants (RLS)", async () => {
    const { opportunities, aceRelationships, opportunityAwsTeam } = db.schema;
    expect(await db.client.withTenant(idB(), (tx) => tx.select().from(opportunities))).toHaveLength(0);
    expect(await db.client.withTenant(idB(), (tx) => tx.select().from(aceRelationships))).toHaveLength(0);
    expect(await db.client.withTenant(idB(), (tx) => tx.select().from(opportunityAwsTeam))).toHaveLength(0);
  });
});
