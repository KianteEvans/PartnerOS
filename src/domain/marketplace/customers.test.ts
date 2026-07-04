import { describe, it, expect } from "vitest";
import { rollupCustomers, type CustomerInputs } from "@/domain/marketplace/customers";

const TODAY = "2026-06-30";

const inputs: CustomerInputs = {
  entitlements: [
    { customerIdentifier: "cust-a", expirationDate: "2027-01-01" }, // active
    { customerIdentifier: "cust-a", expirationDate: "2026-01-01" }, // expired
    { customerIdentifier: "cust-b", expirationDate: null }, // perpetual -> active
  ],
  agreements: [
    { customerIdentifier: "cust-a", totalValue: 50_000 },
    { customerIdentifier: "cust-b", totalValue: 120_000 },
    { customerIdentifier: "cust-b", totalValue: 30_000 },
  ],
  metering: [
    { customerIdentifier: "cust-a", quantity: 10, status: "accepted", usageTimestamp: new Date("2026-06-01") },
    { customerIdentifier: "cust-a", quantity: 5, status: "accepted", usageTimestamp: new Date("2026-06-20") },
    { customerIdentifier: "cust-a", quantity: 99, status: "rejected", usageTimestamp: new Date("2026-06-25") }, // ignored
  ],
  directory: [{ customerIdentifier: "cust-b", customerAwsAccountId: "111122223333" }],
};

describe("rollupCustomers", () => {
  const out = rollupCustomers(inputs, TODAY);

  it("produces one row per customer, sorted by agreement value desc", () => {
    expect(out.map((c) => c.customerIdentifier)).toEqual(["cust-b", "cust-a"]); // b: 150k, a: 50k
  });

  it("counts entitlements and active (non-expired) entitlements", () => {
    const a = out.find((c) => c.customerIdentifier === "cust-a")!;
    expect(a.entitlements).toBe(2);
    expect(a.activeEntitlements).toBe(1);
    const b = out.find((c) => c.customerIdentifier === "cust-b")!;
    expect(b.activeEntitlements).toBe(1); // perpetual counts active
  });

  it("sums agreements + TCV and only accepted metered usage, tracking last usage", () => {
    const a = out.find((c) => c.customerIdentifier === "cust-a")!;
    expect(a.agreements).toBe(1);
    expect(a.tcvCents).toBe(50_000);
    expect(a.acceptedUsage).toBe(15); // 10 + 5; rejected ignored
    expect(a.lastUsage).toEqual(new Date("2026-06-20"));
  });

  it("joins the AWS account id from the directory, blank when unresolved", () => {
    expect(out.find((c) => c.customerIdentifier === "cust-b")!.awsAccountId).toBe("111122223333");
    expect(out.find((c) => c.customerIdentifier === "cust-a")!.awsAccountId).toBe("");
  });
});
