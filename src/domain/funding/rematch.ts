import { matchPrograms, type DealProfile, type PartnerContext } from "@/domain/funding/eligibility";
import type { OpportunityStage } from "@/domain/ace/opportunities";
import type { Decision } from "@/domain/command/brief";

/**
 * Pure "funding re-match" detector: which OPEN deals are eligible for an AWS funding
 * program they have NOT applied for yet — money the partner is leaving on the table.
 * Reuses the eligibility matcher; the new judgement is subtracting the programs a deal
 * has ALREADY submitted for, so the Command Center + playbook engine surface only the
 * gap. No DB, no clock — deterministic and unit-testable.
 *
 * Programs managed internally in MDF are excluded: they are tracked in the MDF section,
 * not `funding_submissions`, so they would always look un-applied here (false positives).
 */

/** Deals below this are not worth a funding chase; keeps the queue high-signal. */
export const MIN_REMATCH_AMOUNT = 50_000;

/** Only mid-funnel deals are realistically fundable (not prospect / launched / lost). */
export const FUNDABLE_STAGES: readonly OpportunityStage[] = [
  "qualified",
  "tech_validation",
  "business_validation",
  "committed",
];

/** At most this many programs listed per deal, best-fit first. */
export const MAX_REMATCH_PROGRAMS = 3;

export interface RematchOpp {
  readonly id: string;
  readonly name: string;
  readonly amount: number;
  readonly ownerUserId: string | null;
  readonly profile: DealProfile;
}

/** An (opportunity, program) pair the partner has already submitted a funding request for. */
export interface AppliedPair {
  readonly opportunityId: string;
  readonly programKey: string;
}

export interface RematchProgram {
  readonly key: string;
  readonly name: string;
}

export interface RematchCandidate {
  readonly oppId: string;
  readonly oppName: string;
  readonly amount: number;
  readonly ownerUserId: string | null;
  /** Eligible programs this deal has NOT applied for, best-fit first. */
  readonly programs: readonly RematchProgram[];
}

export interface RematchOptions {
  readonly minAmount?: number;
  readonly maxPrograms?: number;
}

/**
 * Open deals eligible for a funding program they have not applied for, biggest deals
 * first (most money at stake). Deals below the floor / off the fundable-stage ladder are
 * skipped; programs already submitted for a deal are subtracted per deal.
 */
export function buildRematchCandidates(
  opps: readonly RematchOpp[],
  applied: readonly AppliedPair[],
  context: PartnerContext,
  opts: RematchOptions = {},
): RematchCandidate[] {
  const minAmount = opts.minAmount ?? MIN_REMATCH_AMOUNT;
  const maxPrograms = opts.maxPrograms ?? MAX_REMATCH_PROGRAMS;

  // oppId -> the set of program keys already submitted for that deal.
  const appliedByOpp = new Map<string, Set<string>>();
  for (const a of applied) {
    const set = appliedByOpp.get(a.opportunityId) ?? new Set<string>();
    set.add(a.programKey);
    appliedByOpp.set(a.opportunityId, set);
  }

  const out: RematchCandidate[] = [];
  for (const o of opps) {
    if (o.profile.status !== "open") continue;
    if (o.amount < minAmount) continue;
    if (!FUNDABLE_STAGES.includes(o.profile.stage)) continue;

    const appliedKeys = appliedByOpp.get(o.id) ?? new Set<string>();
    const fresh = matchPrograms(o.profile, context)
      .filter((m) => m.eligible)
      .filter((m) => m.program.managedInternally !== "mdf")
      .filter((m) => !appliedKeys.has(m.program.key))
      .slice(0, maxPrograms)
      .map((m) => ({ key: m.program.key, name: m.program.name }));

    if (fresh.length === 0) continue;
    out.push({
      oppId: o.id,
      oppName: o.name,
      amount: o.amount,
      ownerUserId: o.ownerUserId,
      programs: fresh,
    });
  }

  return out.sort((a, b) => b.amount - a.amount || a.oppName.localeCompare(b.oppName));
}

/** One prescriptive "apply for funding" decision per re-match candidate. */
export function fundingRematchDecisions(candidates: readonly RematchCandidate[]): Decision[] {
  return candidates.map((c) => ({
    id: `rematch-${c.oppId}`,
    severity: "medium" as const,
    situation: "funding_rematch" as const,
    title: `Funding available: ${c.oppName}`,
    detail: `Eligible for ${c.programs.map((p) => p.name).join(", ")} — no application yet.`,
    ownerUserId: c.ownerUserId,
    dueDate: null,
    link: `/ace/${c.oppId}`,
  }));
}
