import { describe, it, expect } from "vitest";
import {
  mapPcStage,
  mapPcStatus,
  toMirrorRow,
  mapAwsTitle,
  roleForTitle,
  toAwsContact,
  toAwsTeam,
  engagementScore,
  nextBestActions,
} from "@/domain/aws/mapping";

describe("mapPcStage", () => {
  it("maps Partner Central stages to the ACE enum, case/space-insensitively", () => {
    expect(mapPcStage("Prospect")).toBe("prospect");
    expect(mapPcStage("Technical Validation")).toBe("tech_validation");
    expect(mapPcStage("Business Validation")).toBe("business_validation");
    expect(mapPcStage("Committed")).toBe("committed");
    expect(mapPcStage("Launched")).toBe("launched");
    expect(mapPcStage("Closed Lost")).toBe("closed_lost");
  });
  it("falls back to prospect for unknown / missing stages", () => {
    expect(mapPcStage("Some New Stage")).toBe("prospect");
    expect(mapPcStage(null)).toBe("prospect");
    expect(mapPcStage(undefined)).toBe("prospect");
  });
});

describe("mapPcStatus", () => {
  it("derives win/loss/open from the stage", () => {
    expect(mapPcStatus("Launched")).toBe("won");
    expect(mapPcStatus("Closed Lost")).toBe("lost");
    expect(mapPcStatus("Qualified")).toBe("open");
    expect(mapPcStatus(null)).toBe("open");
  });
});

describe("toMirrorRow", () => {
  it("maps a full summary (customer company name is the display name)", () => {
    const row = toMirrorRow({
      Id: "O123",
      Customer: { Account: { CompanyName: "Globex" } },
      LifeCycle: { Stage: "Business Validation" },
      Project: { ExpectedCustomerSpend: [{ Amount: "12000.50", CurrencyCode: "USD" }] },
    });
    expect(row).toEqual({
      externalId: "O123",
      name: "Globex",
      accountName: "Globex",
      stage: "business_validation",
      status: "open",
      amount: 12001,
      awsStageRaw: "Business Validation",
    });
  });
  it("falls back name → account → partner ref → id, and amount → 0", () => {
    expect(
      toMirrorRow({ Id: "O9", PartnerOpportunityIdentifier: "CRM-9", LifeCycle: { Stage: "Prospect" } }),
    ).toMatchObject({ name: "CRM-9", amount: 0 });
    expect(toMirrorRow({ Id: "O9", LifeCycle: { Stage: "Prospect" } })?.name).toBe("O9");
  });
  it("returns null without an opportunity id", () => {
    expect(toMirrorRow({ LifeCycle: { Stage: "Prospect" } })).toBeNull();
  });
});

describe("mapAwsTitle", () => {
  it("maps the six AWS business titles, casing/spacing-insensitive", () => {
    expect(mapAwsTitle("AWSSalesRep")).toBe("aws_sales_rep");
    expect(mapAwsTitle("AWSAccountOwner")).toBe("aws_account_owner");
    expect(mapAwsTitle("WWPSPDM")).toBe("wwps_pdm");
    expect(mapAwsTitle("PDM")).toBe("pdm");
    expect(mapAwsTitle("psm")).toBe("psm");
    expect(mapAwsTitle("ISV SM")).toBe("isv_sm");
  });
  it("returns null for PSA / partner-side / unknown / empty titles", () => {
    expect(mapAwsTitle("PSA")).toBeNull();
    expect(mapAwsTitle("PartnerAccountManager")).toBeNull();
    expect(mapAwsTitle("OpportunityOwner")).toBeNull();
    expect(mapAwsTitle("")).toBeNull();
    expect(mapAwsTitle(undefined)).toBeNull();
  });
});

describe("roleForTitle", () => {
  it("buckets sales/account-owner as seller, the rest as partner_manager", () => {
    expect(roleForTitle("aws_sales_rep")).toBe("seller");
    expect(roleForTitle("aws_account_owner")).toBe("seller");
    expect(roleForTitle("psm")).toBe("partner_manager");
    expect(roleForTitle("pdm")).toBe("partner_manager");
    expect(roleForTitle("isv_sm")).toBe("partner_manager");
  });
});

describe("toAwsContact", () => {
  it("builds a deduped contact (email lowercased, name from first/last)", () => {
    expect(
      toAwsContact({ BusinessTitle: "AWSSalesRep", Email: "Jane.AE@AMAZON.com", FirstName: "Jane", LastName: "Patel" }),
    ).toEqual({ email: "jane.ae@amazon.com", name: "Jane Patel", title: "aws_sales_rep", role: "seller" });
  });
  it("falls back name -> email local part -> 'AWS contact'", () => {
    expect(toAwsContact({ BusinessTitle: "PSM", Email: "psm@amazon.com" })?.name).toBe("psm");
  });
  it("returns null without an email or for an unknown title", () => {
    expect(toAwsContact({ BusinessTitle: "PSM" })).toBeNull();
    expect(toAwsContact({ BusinessTitle: "PSA", Email: "x@amazon.com" })).toBeNull();
  });
});

describe("toAwsTeam", () => {
  it("resolves the team, deduping by email (first title wins) and dropping unknown/teamless", () => {
    const team = toAwsTeam({
      OpportunityTeam: [
        { BusinessTitle: "AWSSalesRep", Email: "jane@amazon.com", FirstName: "Jane" },
        { BusinessTitle: "PSM", Email: "JANE@amazon.com" }, // same person, deduped
        { BusinessTitle: "PSA", Email: "sa@amazon.com" }, // unknown title -> dropped
        { BusinessTitle: "PDM", Email: "" }, // no email -> dropped
        { BusinessTitle: "ISVSM", Email: "isv@amazon.com", FirstName: "Sam", LastName: "Lee" },
      ],
    });
    expect(team).toHaveLength(2);
    expect(team[0]).toMatchObject({ email: "jane@amazon.com", title: "aws_sales_rep" });
    expect(team[1]).toMatchObject({ email: "isv@amazon.com", title: "isv_sm", name: "Sam Lee" });
  });
  it("is empty for a teamless summary", () => {
    expect(toAwsTeam({})).toEqual([]);
    expect(toAwsTeam({ OpportunityTeam: [] })).toEqual([]);
  });
});

describe("insights", () => {
  it("extracts engagement score + next best actions, sliced", () => {
    expect(engagementScore({ Insights: { EngagementScore: "High" } })).toBe("High");
    expect(nextBestActions({ Insights: { NextBestActions: "Schedule EBC" } })).toBe("Schedule EBC");
    expect(engagementScore({})).toBe("");
    expect(nextBestActions({})).toBe("");
  });
});
