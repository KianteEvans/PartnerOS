import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Marketplace metering bulk-resubmit (op-level: new record + source annotation,
 * double-resubmit block, cross-tenant no-op) and the billing agreement
 * drill-down loader (exact charge matching on the TEXT AWS identifier, the
 * empty-identifier guard, linked private offer, RLS).
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let ops: typeof import("@/domain/marketplace/operations");
let load: typeof import("@/domain/marketplace/load");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let listingA = "";
let listingB = "";

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
    { permission, idempotencyKey: key, rawBody: "{}", action: "marketplace.test", resourceType: "marketplace_metering", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  ops = await import("@/domain/marketplace/operations");
  load = await import("@/domain/marketplace/load");

  const { withSystem } = db.client;
  const { tenants, users, marketplaceListings } = db.schema;
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

    const listings = await tx
      .insert(marketplaceListings)
      .values([
        { tenantId: tenantA, entityId: "e-a", title: "Acme SaaS", status: "published", productCode: "acmeprod" },
        { tenantId: tenantB, entityId: "e-b", title: "Globex SaaS", status: "published", productCode: "globexprod" },
      ])
      .returning({ id: marketplaceListings.id, tenantId: marketplaceListings.tenantId });
    listingA = listings.find((l) => l.tenantId === tenantA)!.id;
    listingB = listings.find((l) => l.tenantId === tenantB)!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

async function insertRejected(tenantId: string, listingId: string, dimension: string): Promise<string> {
  const { withSystem } = db.client;
  const { marketplaceMeteringRecords } = db.schema;
  return withSystem(async (tx) => {
    const [r] = await tx
      .insert(marketplaceMeteringRecords)
      .values({
        tenantId,
        listingId,
        dimension,
        customerIdentifier: "cust-1",
        quantity: 5,
        status: "rejected",
        result: "Rejected",
      })
      .returning({ id: marketplaceMeteringRecords.id });
    return r!.id;
  });
}

describe("metering bulk resubmit", () => {
  it("inserts the retry outcome as a NEW record and annotates the source", async () => {
    const sourceId = await insertRejected(tenantA, listingA, "users");

    const res = await run("marketplace:update", "resub-1", (ctx) =>
      ops.resubmitMeteringOp(ctx, [
        {
          sourceId,
          listingId: listingA,
          result: { meteringRecordId: "mr-1", status: "accepted", dimension: "users", customerIdentifier: "cust-1", quantity: 5 },
        },
      ]),
    );
    expect(res.body.resubmitted).toBe(1);

    const { withSystem } = db.client;
    const { marketplaceMeteringRecords } = db.schema;
    const rows = await withSystem((tx) =>
      tx
        .select({
          id: marketplaceMeteringRecords.id,
          status: marketplaceMeteringRecords.status,
          result: marketplaceMeteringRecords.result,
        })
        .from(marketplaceMeteringRecords)
        .where(and(eq(marketplaceMeteringRecords.tenantId, tenantA), eq(marketplaceMeteringRecords.dimension, "users"))),
    );
    expect(rows).toHaveLength(2);
    const source = rows.find((r) => r.id === sourceId)!;
    expect(source.status).toBe("rejected"); // honest history
    expect(source.result).toBe("Resubmitted");
    const retry = rows.find((r) => r.id !== sourceId)!;
    expect(retry.status).toBe("accepted");
    expect(retry.result).toBe("Success");
  });

  it("skips a source already annotated Resubmitted (no double retry)", async () => {
    const sourceId = await insertRejected(tenantA, listingA, "api-calls");
    const item = {
      sourceId,
      listingId: listingA,
      result: { meteringRecordId: "", status: "accepted" as const, dimension: "api-calls", customerIdentifier: "cust-1", quantity: 5 },
    };
    const first = await run("marketplace:update", "resub-2a", (ctx) => ops.resubmitMeteringOp(ctx, [item]));
    expect(first.body.resubmitted).toBe(1);
    const second = await run("marketplace:update", "resub-2b", (ctx) => ops.resubmitMeteringOp(ctx, [item]));
    expect(second.body.resubmitted).toBe(0);

    const { withSystem } = db.client;
    const { marketplaceMeteringRecords } = db.schema;
    const rows = await withSystem((tx) =>
      tx
        .select({ id: marketplaceMeteringRecords.id })
        .from(marketplaceMeteringRecords)
        .where(and(eq(marketplaceMeteringRecords.tenantId, tenantA), eq(marketplaceMeteringRecords.dimension, "api-calls"))),
    );
    expect(rows).toHaveLength(2); // source + ONE retry
  });

  it("leaves another tenant's record untouched (RLS + tenant guard)", async () => {
    const foreignId = await insertRejected(tenantB, listingB, "seats");
    const res = await run("marketplace:update", "resub-3", (ctx) =>
      ops.resubmitMeteringOp(ctx, [
        {
          sourceId: foreignId,
          listingId: listingB,
          result: { meteringRecordId: "", status: "accepted", dimension: "seats", customerIdentifier: "cust-1", quantity: 5 },
        },
      ]),
    );
    expect(res.body.resubmitted).toBe(0);

    const { withSystem } = db.client;
    const { marketplaceMeteringRecords } = db.schema;
    const rows = await withSystem((tx) =>
      tx
        .select({ result: marketplaceMeteringRecords.result })
        .from(marketplaceMeteringRecords)
        .where(and(eq(marketplaceMeteringRecords.tenantId, tenantB), eq(marketplaceMeteringRecords.dimension, "seats"))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.result).toBe("Rejected"); // not annotated
  });
});

describe("loadAgreementDetail", () => {
  let agreementRowId = "";
  let emptyRefRowId = "";

  beforeAll(async () => {
    const { withSystem } = db.client;
    const { marketplaceAgreements, marketplaceCharges, marketplacePrivateOffers } = db.schema;
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(marketplaceAgreements)
        .values([
          {
            tenantId: tenantA,
            agreementId: "agr-123",
            listingId: listingA,
            customerIdentifier: "cust-acme",
            offerType: "Private offer",
            status: "ACTIVE",
            startDate: "2026-01-01",
            endDate: "2026-12-31",
            totalValue: 1_200_000,
          },
          // Locally tracked agreement with no AWS identifier yet.
          { tenantId: tenantA, agreementId: "", customerIdentifier: "cust-blank", totalValue: 5000 },
        ])
        .returning({ id: marketplaceAgreements.id, agreementId: marketplaceAgreements.agreementId });
      agreementRowId = rows.find((r) => r.agreementId === "agr-123")!.id;
      emptyRefRowId = rows.find((r) => r.agreementId === "")!.id;

      await tx.insert(marketplaceCharges).values([
        // Two charges on the real agreement... (charge_ref is unique per tenant)
        { tenantId: tenantA, chargeRef: "ch-1", agreementId: "agr-123", billingPeriodStart: "2026-01-01", billingPeriodEnd: "2026-01-31", dimension: "users", quantity: 10, amount: 100_000 },
        { tenantId: tenantA, chargeRef: "ch-2", agreementId: "agr-123", billingPeriodStart: "2026-02-01", billingPeriodEnd: "2026-02-28", dimension: "users", quantity: 10, amount: 100_000 },
        // ...one unreferenced charge that must NOT attach to the empty-ref agreement...
        { tenantId: tenantA, chargeRef: "ch-3", agreementId: "", billingPeriodStart: "2026-01-01", dimension: "misc", quantity: 1, amount: 999 },
        // ...and one on another agreement id entirely.
        { tenantId: tenantA, chargeRef: "ch-4", agreementId: "agr-other", billingPeriodStart: "2026-01-01", dimension: "users", quantity: 1, amount: 777 },
      ]);

      await tx.insert(marketplacePrivateOffers).values({
        tenantId: tenantA,
        listingId: listingA,
        agreementId: agreementRowId,
        title: "Acme private offer",
        customerName: "Acme Corp",
        offerValue: 1_200_000,
        status: "accepted",
      });
    });
  });

  it("returns the agreement with exactly its charges, total, listing and offer", async () => {
    const d = await load.loadAgreementDetail(idA(), agreementRowId);
    expect(d).not.toBeNull();
    expect(d!.customerIdentifier).toBe("cust-acme");
    expect(d!.listingTitle).toBe("Acme SaaS");
    expect(d!.charges).toHaveLength(2);
    expect(d!.chargedTotal).toBe(200_000);
    expect(d!.offer?.title).toBe("Acme private offer");
    expect(d!.offer?.status).toBe("accepted");
  });

  it("guards the empty AWS identifier: zero charges, never every unref'd charge", async () => {
    const d = await load.loadAgreementDetail(idA(), emptyRefRowId);
    expect(d).not.toBeNull();
    expect(d!.charges).toHaveLength(0);
    expect(d!.chargedTotal).toBe(0);
    expect(d!.offer).toBeNull();
  });

  it("returns null for another tenant's agreement (RLS)", async () => {
    expect(await load.loadAgreementDetail(idB(), agreementRowId)).toBeNull();
  });
});
