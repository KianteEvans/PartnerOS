import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Co-sell private-offer bridge (Wave 2, Slice A). Verifies the tracker lifecycle
 * (draft -> sent) and the reconcile-on-sync: when billing sync brings in an AWS
 * agreement matching a SENT offer's customer, the offer auto-accepts + links the
 * agreement. Tenant B's offer for the same customer must NOT reconcile off A's sync (RLS).
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let offerOps: typeof import("@/domain/marketplace/offer-operations");
let mktOps: typeof import("@/domain/marketplace/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let listingA = "";
let oppA = "";
let oppB = "";
let offerA = "";
let offerB = "";

function identity(tenantId: string, userId: string) {
  return {
    tenantId,
    userId,
    oidcSubject: `sub-${userId}`,
    epoch: 0,
    email: `${userId}@test`,
    role: "owner" as const,
  };
}
const idA = () => identity(tenantA, ownerA);
const idB = () => identity(tenantB, ownerB);

async function run<T>(permission: Permission, key: string, handler: (ctx: MutationContext) => Promise<T>, who = idA) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "offer.test", resourceType: "marketplace_private_offer", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  offerOps = await import("@/domain/marketplace/offer-operations");
  mktOps = await import("@/domain/marketplace/operations");

  const { withSystem } = db.client;
  const { tenants, users, opportunities, marketplaceListings } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const us = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "own-a", email: "a@a.test", role: "owner" },
        { tenantId: tenantB, oidcSubject: "own-b", email: "b@b.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = us.find((u) => u.sub === "own-a")!.id;
    ownerB = us.find((u) => u.sub === "own-b")!.id;

    const [la] = await tx
      .insert(marketplaceListings)
      .values({ tenantId: tenantA, entityId: "e-a", title: "Acme SaaS", status: "published" })
      .returning({ id: marketplaceListings.id });
    listingA = la!.id;

    const opps = await tx
      .insert(opportunities)
      .values([
        { tenantId: tenantA, name: "Deal X", status: "open" },
        { tenantId: tenantB, name: "B deal", status: "open" },
      ])
      .returning({ id: opportunities.id, name: opportunities.name });
    oppA = opps.find((o) => o.name === "Deal X")!.id;
    oppB = opps.find((o) => o.name === "B deal")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("private-offer bridge", () => {
  it("drafts then sends a private offer attributed to the co-sell deal", async () => {
    const res = await run("marketplace:create", "create-a", (ctx) =>
      offerOps.createPrivateOfferOp(ctx, {
        title: "Deal X — private offer",
        opportunityId: oppA,
        listingId: listingA,
        customerIdentifier: "cust-x",
        customerName: "Customer X",
        offerValue: 90_000,
        discountPct: 10,
        currency: "USD",
        expirationDate: null,
        notes: "",
        ownerUserId: null,
      }),
    );
    offerA = res.body.id;
    expect(offerA).toBeTruthy();

    await run("marketplace:update", "send-a", (ctx) => offerOps.setPrivateOfferStatusOp(ctx, { id: offerA, status: "sent" }));
    const [row] = await db.client.withTenant(idA(), (tx) =>
      tx.select().from(db.schema.marketplacePrivateOffers).where(eq(db.schema.marketplacePrivateOffers.id, offerA)),
    );
    expect(row!.status).toBe("sent");
    expect(row!.sentAt).not.toBeNull();
    expect(row!.agreementId).toBeNull();
  });

  it("reconciles a sent offer onto a matching agreement on billing sync (auto-accept + link)", async () => {
    // Tenant B also has a sent offer for the SAME customer — must stay untouched by A's sync.
    const bRes = await run(
      "marketplace:create",
      "create-b",
      (ctx) =>
        offerOps.createPrivateOfferOp(ctx, {
          title: "B — private offer",
          opportunityId: oppB,
          listingId: null,
          customerIdentifier: "cust-x",
          customerName: "Customer X",
          offerValue: 50_000,
          discountPct: 0,
          currency: "USD",
          expirationDate: null,
          notes: "",
          ownerUserId: null,
        }),
      idB,
    );
    offerB = bRes.body.id;
    await run("marketplace:update", "send-b", (ctx) => offerOps.setPrivateOfferStatusOp(ctx, { id: offerB, status: "sent" }), idB);

    // A's billing sync brings in the matching agreement -> reconcile at the end.
    await run("marketplace:sync", "sync-a", (ctx) =>
      mktOps.syncBillingOp(
        ctx,
        [{ agreementId: "agr-x", customerIdentifier: "cust-x", offerType: "PrivateOffer", status: "ACTIVE", startDate: null, endDate: null, acceptanceTime: null }],
        [],
      ),
    );

    const [a] = await db.client.withTenant(idA(), (tx) =>
      tx.select().from(db.schema.marketplacePrivateOffers).where(eq(db.schema.marketplacePrivateOffers.id, offerA)),
    );
    expect(a!.status).toBe("accepted");
    expect(a!.agreementId).not.toBeNull();
    expect(a!.decidedAt).not.toBeNull();

    // RLS: B's offer for the same customer is untouched by A's sync.
    const [b] = await db.client.withTenant(idB(), (tx) =>
      tx.select().from(db.schema.marketplacePrivateOffers).where(eq(db.schema.marketplacePrivateOffers.id, offerB)),
    );
    expect(b!.status).toBe("sent");
    expect(b!.agreementId).toBeNull();
  });

  it("guards the state machine: cannot skip straight to accepted", async () => {
    const res = await run("marketplace:create", "create-guard", (ctx) =>
      offerOps.createPrivateOfferOp(ctx, {
        title: "Guard",
        opportunityId: null,
        listingId: null,
        customerIdentifier: "cust-guard",
        customerName: "G",
        offerValue: 1000,
        discountPct: 0,
        currency: "USD",
        expirationDate: null,
        notes: "",
        ownerUserId: null,
      }),
    );
    await expect(
      run("marketplace:update", "bad-transition", (ctx) => offerOps.setPrivateOfferStatusOp(ctx, { id: res.body.id, status: "accepted" })),
    ).rejects.toThrow();
  });
});
