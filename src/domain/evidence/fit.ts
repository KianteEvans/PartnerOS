import {
  PROGRAM_LIBRARY,
  type EvidenceTypeKey,
  type LibraryProgram,
  type LibraryRequirement,
} from "@/domain/programs/library";
import { isExpired, isExpiringSoon } from "@/domain/evidence/inventory";

/**
 * Pure Evidence -> Program FIT engine. Given a tenant's evidence "signals" and a
 * reference `today`, evaluate every AWS program in PROGRAM_LIBRARY: per-requirement
 * COVERAGE (met / partial / gap = the deltas), a 0-100 FIT score, and a ranking of
 * which programs best fit the partner — so the locker can take the guesswork out of
 * which differentiation to pursue, not just store artifacts.
 *
 * No DB and no clock: the caller passes `today` (YYYY-MM-DD). Deterministic and
 * unit-testable, like rep-intelligence.ts.
 *
 * Matching is by EVIDENCE TYPE (latent capability): a signal matches a requirement
 * when signal.evidenceType === requirement.expectedEvidenceType. The same artifact
 * may satisfy the same requirement-type across multiple programs — intentional for
 * RANKING (the bias is uniform across programs sharing a type, so ordering stays
 * meaningful). Confirmed per-requirement progress (explicit evidence<->requirement
 * links) is a separate concern handled by program_requirements; here `readyToPursue`
 * is coverage-gated so thin latent matches never read "ready".
 *
 * Composite: fitScore = COVERAGE_WEIGHT * coveragePercent + a bounded business-model
 * alignment bonus.
 *  - coveragePercent — met=1, partial=0.5, gap=0, averaged over the program's requirements
 *  - bonus — a lightweight partner lean (from the evidence mix) nudges programs whose
 *            deliveryModel/programType align, plus a fundingFit tiebreak
 */

/** Coverage credit per requirement state (averaged -> coveragePercent, 0-100). */
export const COVERAGE_WEIGHTS = { met: 1, partial: 0.5, gap: 0 } as const;

/** fitScore = COVERAGE_WEIGHT * coverage + scaled business-model bonus, clamped 0-100. */
export const COVERAGE_WEIGHT = 0.8; // coverage dominates (max 80 of 100)
export const BONUS_WEIGHT = 0.2; // business-model signal caps the rest (max 20)

/** Business-model bonus sub-points (summed, then scaled into the 20-pt room). */
export const DELIVERY_MATCH_POINTS = 10; // deliveryModel aligns with the partner lean
export const TYPE_MATCH_POINTS = 5; // programType aligns with the partner lean
export const FUNDING_POINTS: Record<string, number> = { high: 5, medium: 2, low: 0 };
/** Max raw bonus before scaling = 10 + 5 + 5 = 20 (so raw points map 1:1 into the room). */
export const MAX_BONUS_POINTS = DELIVERY_MATCH_POINTS + TYPE_MATCH_POINTS + 5;

/** A matching approved signal at/above this quality annotates the reason (tiebreak only). */
export const STRONG_QUALITY = 70;

/** fitScore band cutoffs (mirrors rep-intelligence's healthBand cutoffs). */
export const FIT_BAND_THRESHOLDS = { ready: 75, close: 55, emerging: 30 } as const;

/** Coverage a program needs to count as readyToPursue (deliberately high). */
export const READY_COVERAGE_THRESHOLD = 75;

export type FitBand = "ready" | "close" | "emerging" | "exploratory";

export const FIT_BAND_LABELS: Record<FitBand, string> = {
  ready: "Ready to pursue",
  close: "Within reach",
  emerging: "Emerging fit",
  exploratory: "Exploratory",
};

/** Partner business-model lean inferred from the evidence mix. */
export type PartnerLean = "consulting" | "software" | "security" | "neutral";

export const PARTNER_LEAN_LABELS: Record<PartnerLean, string> = {
  consulting: "Consulting / migration",
  software: "Software / ISV",
  security: "Security",
  neutral: "Generalist",
};

/**
 * Minimal evidence projection the FIT engine needs — decoupled from the Drizzle row.
 * Field names/types match the evidence table so loaders project directly. `reusable`
 * is carried for callers but does NOT affect scoring; `program` (freeform tag) and
 * `qualityScore` only annotate the reason / break ties, never change a requirement's
 * state. `expirationDate` is the only date field, all the expiry checks read.
 */
export interface EvidenceSignal {
  readonly evidenceType: EvidenceTypeKey;
  readonly status: "missing" | "collected" | "in_review" | "approved" | "rejected";
  readonly program: string | null;
  readonly expirationDate: string | null;
  readonly qualityScore: number | null;
  readonly reusable: boolean;
}

/** Per-requirement coverage outcome for one program (the delta). */
export interface RequirementCoverage {
  readonly key: string;
  readonly label: string;
  readonly expectedEvidenceType: EvidenceTypeKey;
  readonly state: "met" | "partial" | "gap";
  /** Human-readable why, e.g. "Approved evidence on file" / "No matching evidence yet". */
  readonly reason: string;
}

/** A program's full fit evaluation against the partner's evidence. */
export interface ProgramFit {
  readonly programKey: string;
  readonly name: string;
  readonly programType: string;
  readonly deliveryModel: string;
  readonly fundingFit: string;
  readonly requirements: readonly RequirementCoverage[];
  readonly metCount: number;
  readonly partialCount: number;
  readonly gapCount: number;
  readonly coveragePercent: number; // 0-100
  readonly fitScore: number; // 0-100 composite
  readonly fitBand: FitBand;
  /** Explainability: the partner lean used + the raw bonus points (pre-scaling). */
  readonly lean: PartnerLean;
  readonly bonusPoints: number; // 0..MAX_BONUS_POINTS
}

/** Headline rollup over a ranked ProgramFit[]. */
export interface FitSummary {
  readonly bestNext: ProgramFit | null;
  readonly readyToPursue: readonly ProgramFit[]; // coveragePercent >= READY_COVERAGE_THRESHOLD
  readonly totalGaps: number; // sum of gapCount across all programs
}

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));
const norm = (s: string): string => s.trim().toLowerCase();

/** Count non-rejected signals of a given evidence type. */
function typeCount(signals: readonly EvidenceSignal[], type: EvidenceTypeKey): number {
  return signals.filter((s) => s.status !== "rejected" && s.evidenceType === type).length;
}

/**
 * Infer the partner's business-model lean from the dominant evidence-type mix. The
 * specialized signals (security, billing) are weighted 2x because you don't acquire
 * them by accident; case studies + architecture are generic consulting-delivery
 * artifacts. Strict max wins; a tie or an empty locker -> neutral (don't guess).
 */
export function partnerLean(signals: readonly EvidenceSignal[]): PartnerLean {
  const security = typeCount(signals, "security") * 2;
  const software = typeCount(signals, "billing") * 2;
  const consulting = typeCount(signals, "case_study") + typeCount(signals, "architecture");
  const scored: ReadonlyArray<readonly [PartnerLean, number]> = [
    ["security", security],
    ["software", software],
    ["consulting", consulting],
  ];
  const max = Math.max(security, software, consulting);
  if (max === 0) return "neutral";
  const winners = scored.filter(([, v]) => v === max);
  return winners.length === 1 ? winners[0]![0] : "neutral";
}

/**
 * Normalized, bidirectional substring match (trim + lowercase). Used both for
 * evidence "program" tag matching here and for free-text targetProgram matching in
 * the competency recommender — one definition so they never drift. Null/empty -> false.
 */
export function normalizedIncludes(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a == null || b == null) return false;
  const x = norm(a);
  const y = norm(b);
  return x !== "" && y !== "" && (x.includes(y) || y.includes(x));
}

function tagMatches(signalProgram: string | null, programName: string): boolean {
  return normalizedIncludes(signalProgram, programName);
}

/**
 * Classify one requirement against the signals (type-availability matching). met = a
 * current approved match; partial = collected/in-review, OR an approved match that is
 * expired/expiring-soon (renewal risk); gap = no real, non-rejected match. `missing`
 * placeholders and `rejected` artifacts never count.
 */
export function coverRequirement(
  requirement: LibraryRequirement,
  signals: readonly EvidenceSignal[],
  today: string,
  programName?: string,
): RequirementCoverage {
  const real = signals.filter(
    (s) =>
      s.evidenceType === requirement.expectedEvidenceType &&
      s.status !== "rejected" &&
      s.status !== "missing",
  );
  const approvedCurrent = real.filter(
    (s) => s.status === "approved" && !isExpired(s, today) && !isExpiringSoon(s, today),
  );
  const approvedRisk = real.filter(
    (s) => s.status === "approved" && (isExpired(s, today) || isExpiringSoon(s, today)),
  );
  const inProgress = real.filter((s) => s.status === "collected" || s.status === "in_review");

  let state: RequirementCoverage["state"];
  let reason: string;
  let contributors: readonly EvidenceSignal[];
  if (approvedCurrent.length > 0) {
    state = "met";
    contributors = approvedCurrent;
    const strong = approvedCurrent.some(
      (s) => s.qualityScore !== null && s.qualityScore >= STRONG_QUALITY,
    );
    reason = strong ? "Approved evidence on file (high quality)" : "Approved evidence on file";
  } else if (approvedRisk.length > 0) {
    state = "partial";
    contributors = approvedRisk;
    reason = "Approved evidence is expiring or expired — renew it";
  } else if (inProgress.length > 0) {
    state = "partial";
    contributors = inProgress;
    reason = "Evidence collected, pending AWS approval";
  } else {
    state = "gap";
    contributors = [];
    reason = "No matching evidence yet";
  }

  if (programName && contributors.some((s) => tagMatches(s.program, programName))) {
    reason += " — tagged to this program";
  }
  return {
    key: requirement.key,
    label: requirement.label,
    expectedEvidenceType: requirement.expectedEvidenceType,
    state,
    reason,
  };
}

export function fitBand(score: number): FitBand {
  if (score >= FIT_BAND_THRESHOLDS.ready) return "ready";
  if (score >= FIT_BAND_THRESHOLDS.close) return "close";
  if (score >= FIT_BAND_THRESHOLDS.emerging) return "emerging";
  return "exploratory";
}

/**
 * Does the program's delivery model align with the partner's lean? "Any" fits any
 * partner WITH a lean; a neutral partner (no discernible mix) earns no alignment
 * bonus, so on an empty locker only fundingFit differentiates.
 */
export function deliveryAligns(lean: PartnerLean, deliveryModel: string): boolean {
  if (lean === "neutral") return false;
  const dm = norm(deliveryModel);
  if (dm === "any") return true;
  if (lean === "software") return dm === "software";
  return dm === "consulting"; // consulting | security lean
}

/** Does the program's type align with the partner's lean? */
export function typeAligns(lean: PartnerLean, programType: string): boolean {
  const pt = norm(programType);
  if (lean === "software") return pt === "program" || pt === "specialization";
  if (lean === "security") return pt === "competency";
  if (lean === "consulting") return pt === "competency" || pt === "service delivery";
  return false; // neutral
}

/** Evaluate one library program: coverage + business-model bonus -> ProgramFit. */
export function evaluateProgramFit(
  program: LibraryProgram,
  signals: readonly EvidenceSignal[],
  today: string,
): ProgramFit {
  const requirements = program.requirements.map((r) =>
    coverRequirement(r, signals, today, program.name),
  );
  let metCount = 0;
  let partialCount = 0;
  let gapCount = 0;
  let creditSum = 0;
  for (const r of requirements) {
    creditSum += COVERAGE_WEIGHTS[r.state];
    if (r.state === "met") metCount += 1;
    else if (r.state === "partial") partialCount += 1;
    else gapCount += 1;
  }
  const coveragePercent =
    requirements.length === 0 ? 0 : Math.round((100 * creditSum) / requirements.length);

  const lean = partnerLean(signals);
  const delivery = deliveryAligns(lean, program.deliveryModel) ? DELIVERY_MATCH_POINTS : 0;
  const typePts = typeAligns(lean, program.programType) ? TYPE_MATCH_POINTS : 0;
  const funding = FUNDING_POINTS[norm(program.fundingFit)] ?? 0;
  const bonusPoints = clamp(delivery + typePts + funding, 0, MAX_BONUS_POINTS);
  const bonusScaled = (bonusPoints / MAX_BONUS_POINTS) * (BONUS_WEIGHT * 100);
  const fitScore = clamp(Math.round(COVERAGE_WEIGHT * coveragePercent + bonusScaled));

  return {
    programKey: program.key,
    name: program.name,
    programType: program.programType,
    deliveryModel: program.deliveryModel,
    fundingFit: program.fundingFit,
    requirements,
    metCount,
    partialCount,
    gapCount,
    coveragePercent,
    fitScore,
    fitBand: fitBand(fitScore),
    lean,
    bonusPoints,
  };
}

/** Rank EVERY program in PROGRAM_LIBRARY, best fit first (stable). */
export function rankProgramFit(
  signals: readonly EvidenceSignal[],
  today: string,
): ProgramFit[] {
  return PROGRAM_LIBRARY.map((p) => evaluateProgramFit(p, signals, today)).sort(
    (a, b) =>
      b.fitScore - a.fitScore ||
      b.coveragePercent - a.coveragePercent ||
      a.programKey.localeCompare(b.programKey),
  );
}

/** Headline rollup for the Evidence Locker fit dashboard. */
export function fitSummary(fits: readonly ProgramFit[]): FitSummary {
  return {
    bestNext: fits[0] ?? null,
    readyToPursue: fits.filter((f) => f.coveragePercent >= READY_COVERAGE_THRESHOLD),
    totalGaps: fits.reduce((s, f) => s + f.gapCount, 0),
  };
}
