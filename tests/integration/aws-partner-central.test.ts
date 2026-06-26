import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";
import type { MirrorRow } from "@/domain/aws/mapping";

/**
 * AWS connector config + Partner Central mirror sync. AWS itself is never called
 * here — the live STS/Partner Central round-trip needs real credentials + a tenant
 * role + sandbox enrollment. We test the gated config save (validation), the
 * idempotent mirror upsert, and RLS isolation between tenants.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let aws: typeof import("@/domain/aws/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";

function identity(tenantId: string, userId: string) {
  return { tenantId, userId, oidcSubject: `sub-${userId}`, epoch: 0, email: `${userId}@t`, role: "owner" as const };
}
function runAs<T>(id: ReturnType<typeof identity>, permission: Permission, key: string, handler: (ctx: MutationContext) => Promise<T>) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "aws.test", resourceType: "aws_connection", handler },
    { resolveIdentity: async () => id },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  aws = await import("@/domain/aws/operations");

  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme-aws" },
      { id: tenantB, name: "Globex", slug: "globex-aws" },
    ]);
    const ins = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@a.test", role: "owner" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@b.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = ins.find((u) => u.sub === "owner-a")!.id;
    ownerB = ins.find((u) => u.sub === "owner-b")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("AWS connector + Partner Central sync", () => {
  it("saves the AWS connection; rejects a bad role ARN when enabled", async () => {
    await runAs(identity(tenantA, ownerA), "settings:manage", "aws-save-1", (ctx) =>
      aws.saveAwsConnectionOp(ctx, {
        roleArn: "arn:aws:iam::123456789012:role/PartnerOSConnect",
        externalId: "ext-secret",
        region: "us-east-1",
        catalog: "Sandbox",
        enabled: true,
        enrichTeam: false,
      }),
    );
    const [row] = await db.client.withSystem((tx) =>
      tx.select().from(db.schema.awsConnection).where(eq(db.schema.awsConnection.tenantId, tenantA)),
    );
    expect(row!.enabled).toBe(true);
    expect(row!.status).toBe("configured");
    expect(row!.catalog).toBe("Sandbox");

    await expect(
      runAs(identity(tenantA, ownerA), "settings:manage", "aws-save-bad", (ctx) =>
        aws.saveAwsConnectionOp(ctx, {
          roleArn: "not-an-arn",
          externalId: "x",
          region: "us-east-1",
          catalog: "Sandbox",
          enrichTeam: false,
          enabled: true,
        }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("upserts mirror rows idempotently by (tenant, external id)", async () => {
    const rows1: MirrorRow[] = [
      { externalId: "O1", name: "Globex", accountName: "Globex", stage: "qualified", status: "open", amount: 1000, awsStageRaw: "Qualified" },
      { externalId: "O2", name: "Acme", accountName: "Acme", stage: "launched", status: "won", amount: 5000, awsStageRaw: "Launched" },
    ];
    const r1 = await runAs(identity(tenantA, ownerA), "ace:update", "sync-1", (ctx) => aws.syncMirrorOp(ctx, rows1));
    expect(r1.body.count).toBe(2);

    // Re-sync: O1 updated in place, O3 new, O2 untouched — never a duplicate O1.
    const rows2: MirrorRow[] = [
      { externalId: "O1", name: "Globex Inc", accountName: "Globex Inc", stage: "committed", status: "open", amount: 2000, awsStageRaw: "Committed" },
      { externalId: "O3", name: "Initech", accountName: "Initech", stage: "prospect", status: "open", amount: 0, awsStageRaw: "Prospect" },
    ];
    await runAs(identity(tenantA, ownerA), "ace:update", "sync-2", (ctx) => aws.syncMirrorOp(ctx, rows2));

    const mirror = await db.client.withSystem((tx) =>
      tx
        .select()
        .from(db.schema.partnerCentralOpportunities)
        .where(eq(db.schema.partnerCentralOpportunities.tenantId, tenantA))
        .orderBy(db.schema.partnerCentralOpportunities.externalId),
    );
    expect(mirror.map((m) => m.externalId)).toEqual(["O1", "O2", "O3"]);
    const o1 = mirror.find((m) => m.externalId === "O1")!;
    expect(o1.amount).toBe(2000);
    expect(o1.stage).toBe("committed");
    expect(o1.accountName).toBe("Globex Inc");
  });

  it("RLS isolates the connection + mirror per tenant", async () => {
    // Tenant B, even filtering explicitly for tenant A's id, sees nothing — RLS
    // ANDs `tenant_id = B` onto every query inside withTenant.
    const bConn = await db.client.withTenant(identity(tenantB, ownerB), (tx) =>
      tx.select().from(db.schema.awsConnection).where(eq(db.schema.awsConnection.tenantId, tenantA)),
    );
    expect(bConn.length).toBe(0);
    const bMirror = await db.client.withTenant(identity(tenantB, ownerB), (tx) =>
      tx.select().from(db.schema.partnerCentralOpportunities),
    );
    expect(bMirror.length).toBe(0);
  });
});
