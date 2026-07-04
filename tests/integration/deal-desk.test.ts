import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * The Deal Desk loader fuses one opportunity's cross-domain context: funding
 * eligibility (+ applied), MDF support (loose ref), the marketplace agreement
 * chain (solution -> listing -> agreement -> entitlement), and the AWS team's rep
 * health. Verifies all legs assemble + ranked moves, and cross-tenant isolation.
 */

let db: TestDb;
let load: typeof import("@/domain/ace/deal-desk-load");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let oppId = "";

function identity(tenantId: string, userId: string) {
  return { tenantId, userId, role: "owner" };
}

beforeAll(async () => {
  db = await setupTestDb();
  load = await import("@/domain/ace/deal-desk-load");

  const { withSystem } = db.client;
  const s = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(s.tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const users = await tx
      .insert(s.users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: s.users.id, sub: s.users.oidcSubject });
    ownerA = users.find((u) => u.sub === "owner-a")!.id;
    ownerB = users.find((u) => u.sub === "owner-b")!.id;

    const [sol] = await tx.insert(s.solutions).values({ tenantId: tenantA, title: "Analytics Platform" }).returning({ id: s.solutions.id });
    const solId = sol!.id;

    const [rel] = await tx
      .insert(s.aceRelationships)
      .values({ tenantId: tenantA, name: "Jane Patel (AWS)", role: "seller", accountName: "Globex", strength: 78, lastContact: "2026-01-01" })
      .returning({ id: s.aceRelationships.id });
    const relId = rel!.id;

    const [opp] = await tx
      .insert(s.opportunities)
      .values({
        tenantId: tenantA,
        name: "Globex cloud migration",
        accountName: "Globex",
        stage: "business_validation",
        status: "open",
        amount: 250_000,
        source: "amazon_originated",
        ownerUserId: ownerA,
        externalId: "PC-1001",
        solutionId: solId,
        awsContactId: relId,
        nextStep: "Schedule EBC",
        lastInteraction: "2026-01-01", // stale -> at-risk
        closeDate: "2026-09-01",
        routingStatus: "routed",
      })
      .returning({ id: s.opportunities.id });
    oppId = opp!.id;

    await tx.insert(s.opportunityAwsTeam).values({ tenantId: tenantA, opportunityId: oppId, relationshipId: relId, title: "aws_sales_rep" });

    // Funding: an applied MAP submission on this opp.
    await tx.insert(s.fundingSubmissions).values({
      tenantId: tenantA,
      opportunityId: oppId,
      programKey: "map",
      title: "MAP funding",
      fundingType: "cash",
      requestedAmount: 50_000,
      status: "in_review",
    });

    // MDF: linked by loose opportunityRef == the opp's externalId.
    await tx.insert(s.mdfRequests).values({
      tenantId: tenantA,
      title: "re:Invent booth",
      activityType: "event",
      status: "approved",
      requestedAmount: 50_000,
      approvedAmount: 40_000,
      opportunityRef: "PC-1001",
      ownerUserId: ownerA,
    });

    // Marketplace: solution -> listing -> agreement -> entitlement.
    const [listing] = await tx
      .insert(s.marketplaceListings)
      .values({ tenantId: tenantA, entityId: "entity:saas:acme", title: "Acme Analytics", status: "published", solutionId: solId })
      .returning({ id: s.marketplaceListings.id });
    await tx.insert(s.marketplaceAgreements).values({
      tenantId: tenantA,
      agreementId: "agr-1",
      listingId: listing!.id,
      offerType: "private_offer",
      status: "active",
      totalValue: 120_000,
    });
    await tx.insert(s.marketplaceEntitlements).values({ tenantId: tenantA, entitlementId: "ent-1", agreementId: "agr-1", listingId: listing!.id });
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("deal desk loader", () => {
  it("fuses funding, MDF, marketplace, and the AWS team for one opportunity", async () => {
    const model = await load.loadDealDesk(identity(tenantA, ownerA), oppId);
    expect(model).not.toBeNull();
    const m = model!;

    // Funding: matched programs + the applied MAP submission.
    expect(m.fundingMatches.length).toBeGreaterThan(0);
    expect(m.appliedProgramKeys).toContain("map");
    expect(m.eligibleUnapplied.every((p) => p.program.key !== "map")).toBe(true); // applied excluded

    // MDF: matched by the loose opportunityRef == externalId.
    expect(m.mdf).toHaveLength(1);
    expect(m.mdf[0]!.approvedAmount).toBe(40_000);

    // Marketplace: the full chain.
    expect(m.marketplace.listings).toHaveLength(1);
    expect(m.marketplace.agreements).toHaveLength(1);
    expect(m.marketplace.entitlementCount).toBe(1);

    // AWS team + rep health.
    expect(m.awsTeam.length).toBeGreaterThanOrEqual(1);

    // The deal is at-risk + high-value -> a "deal" move is surfaced.
    expect(m.moves.some((mv) => mv.kind === "deal")).toBe(true);
  });

  it("returns null for an opportunity in another tenant (RLS)", async () => {
    const model = await load.loadDealDesk(identity(tenantB, ownerB), oppId);
    expect(model).toBeNull();
  });
});
