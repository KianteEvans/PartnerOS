import { describe, it, expect } from "vitest";
import {
  buildRematchCandidates,
  fundingRematchDecisions,
  MIN_REMATCH_AMOUNT,
  type RematchOpp,
  type AppliedPair,
} from "@/domain/funding/rematch";
import type { PartnerContext, DealProfile } from "@/domain/funding/eligibility";

/**
 * Pure funding re-match: an open deal eligible for a program it has not applied for is a
 * candidate; already-applied programs are subtracted; deals below the floor / off the
 * fundable ladder / already closed are excluded. Uses the real funding catalog with a
 * "maximally eligible" deal, and derives program keys from the result so the test does
 * not hard-code catalog specifics.
 */

// Premier partner with a competency + solution type — maximizes program eligibility.
const ctx: PartnerContext = {
  tier: "premier",
  competencyKeys: ["migration"],
  solutionTypes: ["data-platform"],
};

const maximalProfile: DealProfile = {
  amount: 500_000,
  stage: "committed",
  status: "open",
  source: "partner_originated",
  solutionType: "data-platform",
  competencyKey: "migration",
  workloadType: "migration",
  customerSegment: "enterprise",
};

function mkOpp(over: Omit<Partial<RematchOpp>, "profile"> & { profile?: Partial<DealProfile> } = {}): RematchOpp {
  const { profile, ...rest } = over;
  return {
    id: "opp-1",
    name: "Globex migration",
    amount: 500_000,
    ownerUserId: "user-1",
    profile: { ...maximalProfile, ...profile },
    ...rest,
  };
}

describe("buildRematchCandidates", () => {
  it("surfaces an open, fundable, eligible deal with un-applied programs", () => {
    const out = buildRematchCandidates([mkOpp()], [], ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.oppId).toBe("opp-1");
    expect(out[0]!.amount).toBe(500_000);
    expect(out[0]!.programs.length).toBeGreaterThan(0);
  });

  it("caps the listed programs to maxPrograms, best-fit first", () => {
    const all = buildRematchCandidates([mkOpp()], [], ctx, { maxPrograms: 99 });
    const capped = buildRematchCandidates([mkOpp()], [], ctx, { maxPrograms: 1 });
    expect(capped[0]!.programs).toHaveLength(1);
    // The single capped program is the first of the full best-fit list.
    expect(capped[0]!.programs[0]!.key).toBe(all[0]!.programs[0]!.key);
  });

  it("subtracts every applied program — a fully-applied deal drops out", () => {
    const all = buildRematchCandidates([mkOpp()], [], ctx, { maxPrograms: 99 });
    const applied: AppliedPair[] = all[0]!.programs.map((p) => ({
      opportunityId: "opp-1",
      programKey: p.key,
    }));
    const cleared = buildRematchCandidates([mkOpp()], applied, ctx, { maxPrograms: 99 });
    expect(cleared).toHaveLength(0);
  });

  it("subtracts only the applied program, leaving the rest (when >1 eligible)", () => {
    const all = buildRematchCandidates([mkOpp()], [], ctx, { maxPrograms: 99 });
    if (all[0]!.programs.length < 2) return; // nothing to assert with a single program
    const oneKey = all[0]!.programs[0]!.key;
    const partial = buildRematchCandidates(
      [mkOpp()],
      [{ opportunityId: "opp-1", programKey: oneKey }],
      ctx,
      { maxPrograms: 99 },
    );
    expect(partial[0]!.programs.some((p) => p.key === oneKey)).toBe(false);
    expect(partial[0]!.programs.length).toBe(all[0]!.programs.length - 1);
  });

  it("excludes deals below the amount floor", () => {
    const out = buildRematchCandidates([mkOpp({ amount: MIN_REMATCH_AMOUNT - 1 })], [], ctx);
    expect(out).toHaveLength(0);
  });

  it("excludes deals off the fundable-stage ladder (prospect / launched)", () => {
    expect(buildRematchCandidates([mkOpp({ profile: { stage: "prospect" } })], [], ctx)).toHaveLength(0);
    expect(buildRematchCandidates([mkOpp({ profile: { stage: "launched" } })], [], ctx)).toHaveLength(0);
  });

  it("excludes closed deals (won / lost)", () => {
    expect(buildRematchCandidates([mkOpp({ profile: { status: "won" } })], [], ctx)).toHaveLength(0);
    expect(buildRematchCandidates([mkOpp({ profile: { status: "lost" } })], [], ctx)).toHaveLength(0);
  });

  it("keeps the applied-subtraction scoped to the same opportunity", () => {
    const all = buildRematchCandidates([mkOpp()], [], ctx, { maxPrograms: 99 });
    // An application on a DIFFERENT opp must not suppress this deal's programs.
    const applied: AppliedPair[] = all[0]!.programs.map((p) => ({
      opportunityId: "other-opp",
      programKey: p.key,
    }));
    const out = buildRematchCandidates([mkOpp()], applied, ctx, { maxPrograms: 99 });
    expect(out[0]!.programs.length).toBe(all[0]!.programs.length);
  });

  it("sorts candidates by amount (biggest first)", () => {
    const small = mkOpp({ id: "opp-small", name: "Small", amount: 60_000, profile: { amount: 60_000 } });
    const big = mkOpp({ id: "opp-big", name: "Big", amount: 900_000, profile: { amount: 900_000 } });
    const out = buildRematchCandidates([small, big], [], ctx);
    expect(out.map((c) => c.oppId)).toEqual(["opp-big", "opp-small"]);
  });
});

describe("fundingRematchDecisions", () => {
  it("maps each candidate to a medium funding_rematch decision linking to the Deal Desk", () => {
    const decisions = fundingRematchDecisions([
      { oppId: "o9", oppName: "Acme", amount: 200_000, ownerUserId: "u2", programs: [{ key: "map", name: "MAP" }] },
    ]);
    expect(decisions).toHaveLength(1);
    const d = decisions[0]!;
    expect(d.id).toBe("rematch-o9");
    expect(d.situation).toBe("funding_rematch");
    expect(d.severity).toBe("medium");
    expect(d.title).toContain("Acme");
    expect(d.detail).toContain("MAP");
    expect(d.ownerUserId).toBe("u2");
    expect(d.link).toBe("/ace/o9");
  });

  it("returns nothing for no candidates", () => {
    expect(fundingRematchDecisions([])).toEqual([]);
  });
});
