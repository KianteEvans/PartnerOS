import {
  FUNDING_PROGRAMS,
  type EligibilityCriterion,
  type FundingProgram,
  type WorkloadType,
  type CustomerSegment,
} from "@/domain/funding/catalog";
import { stageProgress, type OpportunityStage, type OpportunityStatus, type OpportunitySource } from "@/domain/ace/opportunities";
import { TIER_ORDER, type TierId } from "@/domain/tiers/catalog";

/**
 * Pure funding-eligibility matcher: score a partner's deal (an ACE opportunity, plus a
 * couple of application-captured hints) against every AWS funding program, and report
 * which criteria are met/unmet. No DB, no clock. This is the "which funding mechanisms
 * apply to this deal" engine ACE cannot offer. `note` criteria are advisory (never gate).
 */

export interface DealProfile {
  readonly amount: number;
  readonly stage: OpportunityStage;
  readonly status: OpportunityStatus;
  readonly source: OpportunitySource;
  readonly solutionType?: string | null;
  readonly competencyKey?: string | null;
  /** Captured on the funding application (not stored on the opportunity). */
  readonly workloadType?: WorkloadType | null;
  readonly customerSegment?: CustomerSegment | null;
}

export interface PartnerContext {
  readonly tier: TierId;
  readonly competencyKeys: readonly string[];
  readonly solutionTypes: readonly string[];
}

export interface ProgramMatch {
  readonly program: FundingProgram;
  readonly score: number; // 0-100 (share of gating criteria met)
  readonly met: readonly EligibilityCriterion[];
  readonly unmet: readonly EligibilityCriterion[];
  /** True when every non-advisory (non-`note`) criterion is met. */
  readonly eligible: boolean;
  readonly rationale: string;
}

function meets(c: EligibilityCriterion, deal: DealProfile, ctx: PartnerContext): boolean {
  switch (c.kind) {
    case "min_tier":
      return TIER_ORDER.indexOf(ctx.tier) >= TIER_ORDER.indexOf(c.tier);
    case "competency_required":
      return ctx.competencyKeys.length > 0;
    case "deal_stage":
      return stageProgress(deal.stage) >= stageProgress(c.minStage);
    case "min_deal_size":
      return deal.amount >= c.amountUsd;
    case "workload_type":
      return deal.workloadType != null && c.workloads.includes(deal.workloadType);
    case "customer_segment":
      return deal.customerSegment != null && c.segments.includes(deal.customerSegment);
    case "source":
      return c.sources.includes(deal.source);
    case "note":
      return true; // advisory — surfaced but never gates
  }
}

export function evaluateProgram(program: FundingProgram, deal: DealProfile, ctx: PartnerContext): ProgramMatch {
  const met: EligibilityCriterion[] = [];
  const unmet: EligibilityCriterion[] = [];
  for (const c of program.eligibility) {
    (meets(c, deal, ctx) ? met : unmet).push(c);
  }
  const gating = program.eligibility.filter((c) => c.kind !== "note");
  const gatingUnmet = unmet.filter((c) => c.kind !== "note");
  const eligible = gatingUnmet.length === 0;
  const score = gating.length === 0 ? 100 : Math.round(((gating.length - gatingUnmet.length) / gating.length) * 100);
  const rationale = eligible
    ? `Meets all ${gating.length} gating criteria.`
    : `${gatingUnmet.length} of ${gating.length} criteria unmet: ${gatingUnmet.map((c) => c.label).join(", ")}.`;
  return { program, score, met, unmet, eligible, rationale };
}

/** Every program scored against one deal, ranked eligible-first then by score. */
export function matchPrograms(deal: DealProfile, ctx: PartnerContext): ProgramMatch[] {
  return FUNDING_PROGRAMS.map((p) => evaluateProgram(p, deal, ctx)).sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      b.score - a.score ||
      a.program.name.localeCompare(b.program.name),
  );
}

export interface DealRef {
  readonly id: string;
  readonly name: string;
  readonly profile: DealProfile;
}

/** Reverse: which of the partner's deals are eligible for one program (score desc). */
export function eligibleDeals(
  program: FundingProgram,
  deals: readonly DealRef[],
  ctx: PartnerContext,
): { readonly deal: DealRef; readonly match: ProgramMatch }[] {
  return deals
    .map((deal) => ({ deal, match: evaluateProgram(program, deal.profile, ctx) }))
    .filter((r) => r.match.eligible)
    .sort((a, b) => b.match.score - a.match.score);
}
