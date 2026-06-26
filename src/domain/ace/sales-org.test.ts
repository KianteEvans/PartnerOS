import { describe, it, expect } from "vitest";
import type { RepHealth } from "@/domain/ace/rep-intelligence";
import {
  repRollups,
  prioritizeReps,
  rollupByRole,
  rollupByAccount,
  coverageGaps,
  salesOrgSummary,
  type SalesOrgRel,
  type SalesOrgOpp,
  type TeamEdge,
} from "@/domain/ace/sales-org";

const rels: SalesOrgRel[] = [
  { id: "r1", name: "Jane Patel", email: "jane@amazon.com", accountName: "Acme" },
  { id: "r2", name: "Sam Lee", email: "sam@amazon.com", accountName: "Acme" },
];
const opps: SalesOrgOpp[] = [
  { id: "o1", accountName: "Acme", status: "open", amount: 100_000 },
  { id: "o2", accountName: "Acme", status: "won", amount: 50_000 },
  { id: "o3", accountName: "Globex", status: "open", amount: 30_000 },
];
const edges: TeamEdge[] = [
  { opportunityId: "o1", relationshipId: "r1", title: "aws_sales_rep" },
  { opportunityId: "o1", relationshipId: "r2", title: "psm" },
  { opportunityId: "o2", relationshipId: "r1", title: "aws_sales_rep" },
  { opportunityId: "o3", relationshipId: "r2", title: "psm" }, // Globex has only a PSM
];

const health = (id: string, band: RepHealth["band"], atStake: boolean, daysSinceContact: number | null): RepHealth => ({
  id,
  name: id,
  role: "seller",
  accountName: "",
  score: 50,
  band,
  recency: 50,
  strength: 50,
  momentum: 50,
  daysSinceContact,
  openCount: 0,
  openValue: 0,
  wonValue: 0,
  originated: 0,
  atStake,
});
const healths: RepHealth[] = [health("r1", "healthy", false, 5), health("r2", "weak", true, 70)];

describe("repRollups", () => {
  it("rolls up open count, open TCV, and closed-won TCV per AWS rep over the junction", () => {
    const rollups = repRollups(rels, edges, opps, healths);
    const r1 = rollups.find((r) => r.id === "r1")!;
    const r2 = rollups.find((r) => r.id === "r2")!;

    expect(r1.openCount).toBe(1); // o1
    expect(r1.openTCV).toBe(100_000);
    expect(r1.closedWonTCV).toBe(50_000); // o2
    expect(r1.dealCount).toBe(2);
    expect(r1.titles).toEqual(["aws_sales_rep"]);
    expect(r1.accounts).toEqual(["Acme"]);
    expect(r1.band).toBe("healthy");

    expect(r2.openCount).toBe(2); // o1 + o3
    expect(r2.openTCV).toBe(130_000);
    expect(r2.closedWonTCV).toBe(0);
    expect(r2.accounts).toEqual(["Acme", "Globex"]);
    expect(r2.atRisk).toBe(true); // weak band + open pipeline
  });
});

describe("prioritizeReps", () => {
  it("puts at-risk reps first, then by open TCV", () => {
    const ordered = prioritizeReps(repRollups(rels, edges, opps, healths));
    expect(ordered.map((r) => r.id)).toEqual(["r2", "r1"]); // r2 is at stake
  });
});

describe("rollupByRole", () => {
  it("aggregates pipeline + rep count per AWS title, in display order", () => {
    const roles = rollupByRole(edges, opps);
    expect(roles.map((r) => r.title)).toEqual(["aws_sales_rep", "psm"]);
    const salesRep = roles.find((r) => r.title === "aws_sales_rep")!;
    expect(salesRep).toMatchObject({ reps: 1, openCount: 1, openTCV: 100_000, closedWonTCV: 50_000 });
    const psm = roles.find((r) => r.title === "psm")!;
    expect(psm).toMatchObject({ reps: 1, openCount: 2, openTCV: 130_000, closedWonTCV: 0 });
  });
});

describe("rollupByAccount", () => {
  it("sums per account and flags thin role coverage", () => {
    const accounts = rollupByAccount(edges, opps);
    const acme = accounts.find((a) => a.account === "Acme")!;
    expect(acme).toMatchObject({ openTCV: 100_000, closedWonTCV: 50_000, hasSalesRep: true, hasPsm: true });
    const globex = accounts.find((a) => a.account === "Globex")!;
    expect(globex).toMatchObject({ openTCV: 30_000, hasSalesRep: false, hasPsm: true });
  });
});

describe("coverageGaps", () => {
  it("flags open opps missing a Sales Rep / PSM (won opps excluded)", () => {
    const gaps = coverageGaps(opps, edges);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({
      opportunityId: "o3",
      account: "Globex",
      missingSalesRep: true,
      missingPsm: false,
    });
  });
});

describe("salesOrgSummary", () => {
  it("sums distinct-opp pipeline (no double-count for multi-rep deals)", () => {
    const rollups = repRollups(rels, edges, opps, healths);
    const gaps = coverageGaps(opps, edges);
    const s = salesOrgSummary(opps, rollups, gaps);
    // o1 (100k) + o3 (30k) open; o2 (50k) won. NOT 230k from summing per-rep openTCV.
    expect(s).toEqual({ reps: 2, openTCV: 130_000, closedWonTCV: 50_000, gaps: 1 });
  });
});
