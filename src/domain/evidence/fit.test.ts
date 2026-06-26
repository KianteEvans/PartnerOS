import { describe, it, expect } from "vitest";
import {
  partnerLean,
  coverRequirement,
  fitBand,
  evaluateProgramFit,
  rankProgramFit,
  fitSummary,
  COVERAGE_WEIGHT,
  BONUS_WEIGHT,
  MAX_BONUS_POINTS,
  READY_COVERAGE_THRESHOLD,
  FIT_BAND_THRESHOLDS,
  DELIVERY_MATCH_POINTS,
  type EvidenceSignal,
} from "@/domain/evidence/fit";
import {
  getLibraryProgram,
  type EvidenceTypeKey,
  type LibraryRequirement,
} from "@/domain/programs/library";

const TODAY = "2026-06-25";

const sig = (over: Partial<EvidenceSignal> = {}): EvidenceSignal => ({
  evidenceType: "case_study",
  status: "approved",
  program: null,
  expirationDate: null,
  qualityScore: null,
  reusable: false,
  ...over,
});
const req = (t: EvidenceTypeKey, key = "r"): LibraryRequirement => ({
  key,
  label: key,
  expectedEvidenceType: t,
});

describe("coverRequirement", () => {
  it("is met on a current approved type-match", () => {
    const c = coverRequirement(req("case_study"), [sig({ status: "approved" })], TODAY);
    expect(c.state).toBe("met");
    expect(c.reason).toContain("Approved");
  });
  it("is partial on collected / in_review", () => {
    expect(coverRequirement(req("case_study"), [sig({ status: "collected" })], TODAY).state).toBe("partial");
    expect(coverRequirement(req("case_study"), [sig({ status: "in_review" })], TODAY).state).toBe("partial");
  });
  it("is partial (renewal risk) on an expired approved match", () => {
    const c = coverRequirement(
      req("case_study"),
      [sig({ status: "approved", expirationDate: "2026-01-01" })],
      TODAY,
    );
    expect(c.state).toBe("partial");
    expect(c.reason).toContain("renew");
  });
  it("is partial (renewal risk) on an expiring-soon approved match", () => {
    const c = coverRequirement(
      req("case_study"),
      [sig({ status: "approved", expirationDate: "2026-07-10" })], // 15 days out
      TODAY,
    );
    expect(c.state).toBe("partial");
  });
  it("is a gap when nothing of the type matches", () => {
    expect(
      coverRequirement(req("case_study"), [sig({ evidenceType: "security" })], TODAY).state,
    ).toBe("gap");
  });
  it("ignores rejected and missing matches", () => {
    expect(coverRequirement(req("case_study"), [sig({ status: "rejected" })], TODAY).state).toBe("gap");
    expect(coverRequirement(req("case_study"), [sig({ status: "missing" })], TODAY).state).toBe("gap");
  });
  it("matches strictly by evidence type", () => {
    expect(
      coverRequirement(req("security"), [sig({ evidenceType: "case_study", status: "approved" })], TODAY).state,
    ).toBe("gap");
  });
  it("annotates high quality without changing the met state", () => {
    expect(
      coverRequirement(req("case_study"), [sig({ status: "approved", qualityScore: 90 })], TODAY).reason,
    ).toContain("high quality");
    const ok = coverRequirement(req("case_study"), [sig({ status: "approved", qualityScore: 40 })], TODAY);
    expect(ok.state).toBe("met");
    expect(ok.reason).not.toContain("high quality");
  });
  it("prefers met when both a current and an expired approved match exist", () => {
    const c = coverRequirement(
      req("case_study"),
      [sig({ status: "approved" }), sig({ status: "approved", expirationDate: "2026-01-01" })],
      TODAY,
    );
    expect(c.state).toBe("met");
  });
  it("annotates a program-tag match in the reason", () => {
    const c = coverRequirement(
      req("case_study"),
      [sig({ status: "approved", program: "Migration Competency" })],
      TODAY,
      "Migration Competency",
    );
    expect(c.reason).toContain("tagged");
  });
});

describe("partnerLean", () => {
  it("leans security when security evidence dominates", () => {
    expect(
      partnerLean([sig({ evidenceType: "security" }), sig({ evidenceType: "security" }), sig({ evidenceType: "case_study" })]),
    ).toBe("security");
  });
  it("leans software when billing/marketplace evidence dominates", () => {
    expect(partnerLean([sig({ evidenceType: "billing" }), sig({ evidenceType: "billing" })])).toBe("software");
  });
  it("leans consulting on case studies + architecture", () => {
    expect(
      partnerLean([sig({ evidenceType: "case_study" }), sig({ evidenceType: "architecture" }), sig({ evidenceType: "case_study" })]),
    ).toBe("consulting");
  });
  it("is neutral on an empty locker or a tie", () => {
    expect(partnerLean([])).toBe("neutral");
    expect(partnerLean([sig({ evidenceType: "security" }), sig({ evidenceType: "billing" })])).toBe("neutral");
  });
  it("ignores rejected evidence", () => {
    expect(
      partnerLean([
        sig({ evidenceType: "security", status: "rejected" }),
        sig({ evidenceType: "security", status: "rejected" }),
        sig({ evidenceType: "billing", status: "collected" }),
      ]),
    ).toBe("software");
  });
});

describe("fitBand", () => {
  it("maps scores to bands at the cutoffs", () => {
    expect(fitBand(75)).toBe("ready");
    expect(fitBand(74)).toBe("close");
    expect(fitBand(55)).toBe("close");
    expect(fitBand(54)).toBe("emerging");
    expect(fitBand(30)).toBe("emerging");
    expect(fitBand(29)).toBe("exploratory");
    expect(fitBand(0)).toBe("exploratory");
  });
});

describe("evaluateProgramFit", () => {
  const security = getLibraryProgram("security_competency")!;
  const migration = getLibraryProgram("migration_competency")!;
  const advanced = getLibraryProgram("advanced_tier")!;

  it("fully covers a security competency for a security partner", () => {
    const signals = [
      sig({ evidenceType: "case_study", status: "approved" }),
      sig({ evidenceType: "security", status: "approved" }),
      sig({ evidenceType: "certification", status: "approved" }),
    ];
    const f = evaluateProgramFit(security, signals, TODAY);
    expect(f.metCount).toBe(3);
    expect(f.coveragePercent).toBe(100);
    expect(f.lean).toBe("security");
    expect(f.bonusPoints).toBe(20); // delivery 10 + type 5 + funding 5
    expect(f.fitScore).toBe(100); // 0.8*100 + 20
    expect(f.fitBand).toBe("ready");
  });

  it("scores partial coverage into the close band", () => {
    const signals = [
      sig({ evidenceType: "case_study", status: "approved" }),
      sig({ evidenceType: "security", status: "collected" }),
    ];
    const f = evaluateProgramFit(security, signals, TODAY);
    expect(f.metCount).toBe(1);
    expect(f.partialCount).toBe(1);
    expect(f.gapCount).toBe(1);
    expect(f.coveragePercent).toBe(50); // (1 + 0.5 + 0)/3
    expect(f.fitScore).toBe(60); // 0.8*50 + 20
    expect(f.fitBand).toBe("close");
  });

  it("ranks a no-evidence tenant by funding fit only (no divide-by-zero)", () => {
    const f = evaluateProgramFit(migration, [], TODAY);
    expect(f.gapCount).toBe(4);
    expect(f.coveragePercent).toBe(0);
    expect(f.lean).toBe("neutral");
    expect(f.bonusPoints).toBe(5); // funding high only
    expect(f.fitScore).toBe(5);
    expect(f.fitBand).toBe("exploratory");
  });

  it('awards the delivery bonus on an "Any"-delivery program', () => {
    const f = evaluateProgramFit(advanced, [sig({ evidenceType: "security" }), sig({ evidenceType: "security" })], TODAY);
    expect(f.bonusPoints).toBe(12); // delivery 10 (Any) + funding 2 (medium); Tier type → 0
    expect(f.bonusPoints).toBeGreaterThanOrEqual(DELIVERY_MATCH_POINTS);
  });

  it("ignores the reusable flag and program tag for the score", () => {
    const base = [sig({ evidenceType: "case_study", status: "approved" })];
    const a = evaluateProgramFit(security, base, TODAY);
    const b = evaluateProgramFit(security, [sig({ evidenceType: "case_study", status: "approved", reusable: true, program: "Security Competency" })], TODAY);
    expect(b.fitScore).toBe(a.fitScore);
    expect(b.coveragePercent).toBe(a.coveragePercent);
  });
});

describe("rankProgramFit", () => {
  it("ranks the best-covered program first", () => {
    const signals = [
      sig({ evidenceType: "case_study", status: "approved" }),
      sig({ evidenceType: "security", status: "approved" }),
      sig({ evidenceType: "certification", status: "approved" }),
    ];
    expect(rankProgramFit(signals, TODAY)[0]!.programKey).toBe("security_competency");
  });
  it("surfaces high-funding programs first on an empty locker", () => {
    const ranked = rankProgramFit([], TODAY);
    // sorted descending
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1]!.fitScore).toBeGreaterThanOrEqual(ranked[i]!.fitScore);
    }
    expect(ranked[0]!.fitScore).toBe(5); // a high-funding program
    const byKey = new Map(ranked.map((f) => [f.programKey, f.fitScore]));
    expect(byKey.get("migration_competency")).toBe(5); // high funding
    expect(byKey.get("isv_accelerate")).toBe(2); // medium funding
  });
  it("is stable across calls", () => {
    const a = rankProgramFit([sig({ evidenceType: "billing", status: "approved" })], TODAY).map((f) => f.programKey);
    const b = rankProgramFit([sig({ evidenceType: "billing", status: "approved" })], TODAY).map((f) => f.programKey);
    expect(a).toEqual(b);
  });
});

describe("fitSummary", () => {
  it("reports bestNext, coverage-gated readyToPursue, and totalGaps", () => {
    const signals = [
      sig({ evidenceType: "case_study", status: "approved" }),
      sig({ evidenceType: "security", status: "approved" }),
      sig({ evidenceType: "certification", status: "approved" }),
    ];
    const s = fitSummary(rankProgramFit(signals, TODAY));
    expect(s.bestNext?.programKey).toBe("security_competency");
    expect(s.readyToPursue.some((f) => f.programKey === "security_competency")).toBe(true);
    expect(s.totalGaps).toBeGreaterThan(0);
  });
  it("does not mark thin latent coverage as readyToPursue", () => {
    const s = fitSummary(rankProgramFit([sig({ evidenceType: "case_study", status: "approved" })], TODAY));
    expect(s.readyToPursue).toHaveLength(0);
  });
  it("is safe on an empty set", () => {
    expect(fitSummary([])).toEqual({ bestNext: null, readyToPursue: [], totalGaps: 0 });
  });
});

describe("constants", () => {
  it("exposes tunable weights", () => {
    expect(COVERAGE_WEIGHT).toBe(0.8);
    expect(BONUS_WEIGHT).toBe(0.2);
    expect(MAX_BONUS_POINTS).toBe(20);
    expect(READY_COVERAGE_THRESHOLD).toBe(75);
    expect(FIT_BAND_THRESHOLDS.ready).toBe(75);
  });
});
