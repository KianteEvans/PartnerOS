import { describe, it, expect } from "vitest";
import {
  scoreEvidence,
  selectEvidenceForControl,
  type GroundingEvidence,
} from "@/domain/applications/grounding";

const ev = (over: Partial<GroundingEvidence> = {}): GroundingEvidence => ({
  id: "e1",
  title: "Generic doc",
  notes: "",
  evidenceType: "other",
  status: "approved",
  qualityScore: null,
  ...over,
});

describe("scoreEvidence", () => {
  it("rewards keyword overlap with the requirement", () => {
    const relevant = ev({ title: "Kubernetes EKS security case study", evidenceType: "case_study" });
    const irrelevant = ev({ title: "Office party photos" });
    const req = "Provide a security customer case study for Kubernetes workloads";
    expect(scoreEvidence(req, "", relevant)).toBeGreaterThan(scoreEvidence(req, "", irrelevant));
  });
  it("weights approved above collected", () => {
    const base = { title: "security control documentation", evidenceType: "security" };
    const approved = ev({ ...base, status: "approved" });
    const collected = ev({ ...base, status: "collected" });
    const req = "security control documentation";
    expect(scoreEvidence(req, "", approved)).toBeGreaterThan(scoreEvidence(req, "", collected));
  });
});

describe("selectEvidenceForControl", () => {
  const pool: GroundingEvidence[] = [
    ev({ id: "match1", title: "Security threat detection case study", evidenceType: "case_study" }),
    ev({ id: "match2", title: "Encryption control documentation", evidenceType: "security" }),
    ev({ id: "weak", title: "Marketing brochure", evidenceType: "other" }),
  ];

  it("ranks relevant evidence first", () => {
    const out = selectEvidenceForControl("Security threat detection requirements", "", pool);
    expect(out[0]!.id).toBe("match1");
  });

  it("respects the max-items cap", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      ev({ id: `m${i}`, title: "security control evidence", evidenceType: "security" }),
    );
    expect(selectEvidenceForControl("security control", "", many, { maxItems: 5 })).toHaveLength(5);
  });

  it("falls back to top approved when nothing matches", () => {
    const noMatch: GroundingEvidence[] = [
      ev({ id: "a", title: "zzz", status: "approved", qualityScore: 90 }),
      ev({ id: "b", title: "yyy", status: "approved", qualityScore: 10 }),
      ev({ id: "c", title: "xxx", status: "collected" }),
    ];
    const out = selectEvidenceForControl("completely unrelated terms", "", noMatch);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.id).toBe("a"); // highest quality approved
    expect(out.every((e) => e.status === "approved")).toBe(true);
  });

  it("truncates long notes", () => {
    const long = ev({ id: "L", title: "security control", evidenceType: "security", notes: "x".repeat(900) });
    const out = selectEvidenceForControl("security control", "", [long], { notesCap: 100 });
    expect(out[0]!.notes.length).toBeLessThanOrEqual(103); // 100 + "..."
  });
});
