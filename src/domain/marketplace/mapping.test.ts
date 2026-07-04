import { describe, it, expect } from "vitest";
import {
  productTypeFromEntityType,
  visibilityFromAws,
  changeStatusFromAws,
  meteringStatusFromAws,
  entitlementValueToInt,
  toIsoDate,
  synthEntitlementRef,
  synthAttributionRef,
  mapEntityToListing,
  mapEntitlement,
  mapAgreement,
  mapUsageResult,
} from "@/domain/marketplace/mapping";

describe("normalizers", () => {
  it("maps catalog entity types to product types (default saas)", () => {
    expect(productTypeFromEntityType("SaaSProduct")).toBe("saas");
    expect(productTypeFromEntityType("AmiProduct")).toBe("ami");
    expect(productTypeFromEntityType("ContainerProduct")).toBe("container");
    expect(productTypeFromEntityType("MachineLearningProduct")).toBe("machine_learning");
    expect(productTypeFromEntityType("ProfessionalServicesProduct")).toBe("professional_services");
    expect(productTypeFromEntityType("Offer")).toBe("saas");
    expect(productTypeFromEntityType(undefined)).toBe("saas");
  });

  it("maps AWS visibility case-insensitively (default limited)", () => {
    expect(visibilityFromAws("Public")).toBe("public");
    expect(visibilityFromAws("restricted")).toBe("restricted");
    expect(visibilityFromAws("Limited")).toBe("limited");
    expect(visibilityFromAws(undefined)).toBe("limited");
  });

  it("maps change-set status (default applying)", () => {
    expect(changeStatusFromAws("PREPARING")).toBe("preparing");
    expect(changeStatusFromAws("Succeeded")).toBe("succeeded");
    expect(changeStatusFromAws("FAILED")).toBe("failed");
    expect(changeStatusFromAws("CANCELLED")).toBe("cancelled");
    expect(changeStatusFromAws("weird")).toBe("applying");
  });

  it("maps metering status (Success => accepted)", () => {
    expect(meteringStatusFromAws("Success")).toBe("accepted");
    expect(meteringStatusFromAws("CustomerNotSubscribed")).toBe("rejected");
    expect(meteringStatusFromAws(undefined)).toBe("rejected");
  });

  it("coerces entitlement values to int across union members", () => {
    expect(entitlementValueToInt({ IntegerValue: 5 })).toBe(5);
    expect(entitlementValueToInt({ DoubleValue: 2.6 })).toBe(3);
    expect(entitlementValueToInt({ BooleanValue: true })).toBe(1);
    expect(entitlementValueToInt({ BooleanValue: false })).toBe(0);
    expect(entitlementValueToInt({ StringValue: "42" })).toBe(42);
    expect(entitlementValueToInt({ StringValue: "n/a" })).toBe(0);
    expect(entitlementValueToInt(undefined)).toBe(0);
  });

  it("formats ISO dates and synthesizes stable refs", () => {
    expect(toIsoDate(new Date("2026-05-15T10:00:00Z"))).toBe("2026-05-15");
    expect(toIsoDate(undefined)).toBeNull();
    expect(synthEntitlementRef("prod-x", "cust-1", "users")).toBe("prod-x:cust-1:users");
    expect(synthAttributionRef("e-1", "AmazonEC2", "2026-05", "marketplace_metering")).toBe(
      "e-1:AmazonEC2:2026-05:marketplace_metering",
    );
  });
});

describe("row mappers", () => {
  it("maps an entity summary to a listing row", () => {
    expect(
      mapEntityToListing({ EntityId: "e-1", Name: "Acme SaaS", EntityType: "SaaSProduct", Visibility: "Public" }),
    ).toEqual({ entityId: "e-1", title: "Acme SaaS", productType: "saas", visibility: "public" });
  });

  it("falls back to the entity id for a missing title and drops id-less entities", () => {
    expect(mapEntityToListing({ EntityId: "e-2", EntityType: "AmiProduct" })).toEqual({
      entityId: "e-2",
      title: "e-2",
      productType: "ami",
      visibility: "limited",
    });
    expect(mapEntityToListing({ Name: "no id" })).toBeNull();
  });

  it("maps an entitlement (synth ref) and drops incomplete ones", () => {
    expect(
      mapEntitlement({
        ProductCode: "pc-1",
        CustomerIdentifier: "cust-1",
        Dimension: "users",
        Value: { IntegerValue: 10 },
        ExpirationDate: new Date("2026-12-31T00:00:00Z"),
      }),
    ).toEqual({
      entitlementRef: "pc-1:cust-1:users",
      productCode: "pc-1",
      customerIdentifier: "cust-1",
      dimension: "users",
      value: 10,
      expirationDate: "2026-12-31",
    });
    expect(mapEntitlement({ ProductCode: "pc-1", Dimension: "users" })).toBeNull();
  });

  it("maps an agreement summary (customer from acceptor.accountId)", () => {
    expect(
      mapAgreement({
        agreementId: "agr-1",
        agreementType: "PurchaseAgreement",
        status: "ACTIVE",
        acceptor: { accountId: "111122223333" },
        startTime: new Date("2026-01-01T00:00:00Z"),
        endTime: new Date("2027-01-01T00:00:00Z"),
        acceptanceTime: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toMatchObject({
      agreementId: "agr-1",
      customerIdentifier: "111122223333",
      offerType: "PurchaseAgreement",
      status: "ACTIVE",
      startDate: "2026-01-01",
      endDate: "2027-01-01",
    });
    expect(mapAgreement({ agreementType: "x" })).toBeNull();
  });

  it("maps a usage record result", () => {
    expect(
      mapUsageResult({
        MeteringRecordId: "mr-1",
        Status: "Success",
        UsageRecord: { Dimension: "users", CustomerIdentifier: "cust-1", Quantity: 7 },
      }),
    ).toEqual({
      meteringRecordId: "mr-1",
      status: "accepted",
      dimension: "users",
      customerIdentifier: "cust-1",
      quantity: 7,
    });
  });
});
