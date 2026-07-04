import { describe, it, expect } from "vitest";
import {
  attributionByService,
  attributionByPeriod,
  attributionTotals,
  methodReadiness,
} from "@/domain/marketplace/prm";

const attributions = [
  { awsService: "AmazonEC2", billingPeriod: "2026-05", amount: 100_00, method: "marketplace_metering" as const },
  { awsService: "AmazonS3", billingPeriod: "2026-05", amount: 40_00, method: "resource_tagging" as const },
  { awsService: "AmazonEC2", billingPeriod: "2026-06", amount: 120_00, method: "marketplace_metering" as const },
];

describe("attribution rollups", () => {
  it("sums by service (desc) and by period (chronological)", () => {
    expect(attributionByService(attributions)).toEqual([
      { key: "AmazonEC2", amountCents: 220_00 },
      { key: "AmazonS3", amountCents: 40_00 },
    ]);
    expect(attributionByPeriod(attributions)).toEqual([
      { key: "2026-05", amountCents: 140_00 },
      { key: "2026-06", amountCents: 120_00 },
    ]);
  });

  it("totals overall and by method", () => {
    expect(attributionTotals(attributions)).toEqual({
      totalCents: 260_00,
      byMethod: { marketplace_metering: 220_00, resource_tagging: 40_00, user_agent: 0 },
    });
  });
});

describe("methodReadiness", () => {
  it("counts active of three methods", () => {
    expect(
      methodReadiness([
        { method: "marketplace_metering", enabled: true, status: "active" },
        { method: "resource_tagging", enabled: true, status: "configured" },
        { method: "user_agent", enabled: false, status: "inactive" },
      ]),
    ).toEqual({ active: 1, configured: 2, total: 3, percent: 33 });
  });

  it("is zero with no active methods", () => {
    expect(methodReadiness([]).percent).toBe(0);
  });
});
