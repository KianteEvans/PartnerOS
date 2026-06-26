import {
  deliveryAligns,
  typeAligns,
  normalizedIncludes,
  fitBand,
  type ProgramFit,
  type PartnerLean,
  type FitBand,
} from "@/domain/evidence/fit";

/**
 * Pure best-fit AWS Competency recommender. Blends THREE independent 0-100 axes into
 * one composite, named-constant, explainable score:
 *   - coverage      = the partner's EVIDENCE coverage (fit.coveragePercent). Note this
 *                     is coveragePercent, NOT fit.fitScore — fitScore already folds in
 *                     an evidence-inferred business-model bonus, so reusing it would
 *                     count the business model twice. The recommender owns the single
 *                     business-model term below.
 *   - businessModel = how well the partner's (declared, else inferred) lean aligns with
 *                     the program's delivery model + type + funding fit.
 *   - readiness     = the relevant GTM/competency assessment module score.
 * Weights renormalize over the terms that are actually present, so a partner with no
 * scored assessment still scores on a true 0-100 scale (never capped). No DB, no clock.
 */

export const REC_COVERAGE_WEIGHT = 0.55; // evidence dominates (most concrete signal)
export const REC_BUSINESS_WEIGHT = 0.25; // declared / inferred business model
export const REC_READINESS_WEIGHT = 0.2; // GTM / competency assessment readiness

/** Business-model term sub-points (summed, clamped 0-100). */
export const DELIVERY_ALIGN_POINTS = 60; // how you deliver (strong)
export const TYPE_ALIGN_POINTS = 30; // what kind of program (medium)
export const REC_FUNDING_POINTS: Record<string, number> = { high: 10, medium: 4, low: 0 };

/** A targetProgram match on a scored assessment nudges that program's readiness term. */
export const TARGET_BOOST = 15;

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));
const norm = (s: string): string => s.trim().toLowerCase();

/** Declared business model (onboarding.partnerType) -> lean. */
export function leanForPartnerType(partnerType: string | null | undefined): PartnerLean {
  switch (norm(partnerType ?? "")) {
    case "isv / software":
      return "software";
    case "consulting / si":
    case "managed services (msp)":
      return "consulting"; // MSPs deliver consulting-shaped competencies
    case "reseller / distributor":
    default:
      return "neutral"; // no competency lean -> don't guess
  }
}

/** Industry only nudges when it is unambiguous (Security). */
export function leanForIndustry(industry: string | null | undefined): PartnerLean {
  return norm(industry ?? "") === "security" ? "security" : "neutral";
}

export interface RecommendProfile {
  readonly partnerType: string | null;
  readonly industry: string | null;
}

export interface RecommendReadiness {
  readonly gtm?: number | undefined;
  readonly competency?: number | undefined;
  readonly specialization?: number | undefined;
  readonly overall?: number | undefined;
  readonly targetProgram?: string | null | undefined;
}

export interface RecommendInput {
  readonly fits: readonly ProgramFit[]; // from rankProgramFit (already ranked)
  readonly profile: RecommendProfile;
  readonly readiness: RecommendReadiness;
  readonly adoptedKeys: ReadonlySet<string>;
}

export type RationaleKind = "evidence" | "business_model" | "readiness" | "target" | "funding";
export type RationaleTone = "ok" | "warn" | "info" | "neutral";

export interface RationaleChip {
  readonly kind: RationaleKind;
  readonly label: string;
  readonly detail: string;
  readonly tone: RationaleTone;
}

export type LeanReconciled = "agree" | "declared_wins" | "evidence_only" | "none";

export interface RecommendationComponents {
  readonly coverageTerm: number;
  readonly businessModelTerm: number;
  readonly readinessTerm: number | null; // null when no assessment signal
  /** Post-renormalization weights (sum to 1), for explainability. */
  readonly weights: { readonly coverage: number; readonly businessModel: number; readonly readiness: number };
}

export interface CompetencyRecommendation {
  readonly programKey: string;
  readonly name: string;
  readonly programType: string;
  readonly deliveryModel: string;
  readonly fundingFit: string;
  readonly recommendationScore: number; // 0-100 composite
  readonly band: FitBand;
  readonly coveragePercent: number; // surfaced so it reconciles with /evidence/fit
  readonly evidenceFitScore: number; // the original fit.ts fitScore (cross-page parity)
  readonly declaredLean: PartnerLean;
  readonly evidenceLean: PartnerLean;
  readonly effectiveLean: PartnerLean;
  readonly leanReconciled: LeanReconciled;
  readonly isAdopted: boolean;
  readonly rationale: readonly RationaleChip[];
  readonly components: RecommendationComponents;
}

const LEAN_LABELS: Record<PartnerLean, string> = {
  consulting: "Consulting",
  software: "Software / ISV",
  security: "Security",
  neutral: "Generalist",
};

/** Reconcile the declared lean (partnerType, with a Security industry nudge) against
 *  the evidence-inferred lean. Declared wins when they disagree (the partner told us;
 *  the evidence may be thin) — but the result is used for the SINGLE business-model
 *  term, never re-added as a separate bonus. */
function reconcileLean(
  profile: RecommendProfile,
  evidenceLean: PartnerLean,
): { declaredLean: PartnerLean; effectiveLean: PartnerLean; reconciled: LeanReconciled } {
  let declaredLean = leanForPartnerType(profile.partnerType);
  if (declaredLean === "neutral") {
    const ind = leanForIndustry(profile.industry);
    if (ind !== "neutral") declaredLean = ind;
  }
  const dn = declaredLean !== "neutral";
  const en = evidenceLean !== "neutral";
  if (dn && en) {
    return declaredLean === evidenceLean
      ? { declaredLean, effectiveLean: declaredLean, reconciled: "agree" }
      : { declaredLean, effectiveLean: declaredLean, reconciled: "declared_wins" };
  }
  if (dn) return { declaredLean, effectiveLean: declaredLean, reconciled: "declared_wins" };
  if (en) return { declaredLean, effectiveLean: evidenceLean, reconciled: "evidence_only" };
  return { declaredLean, effectiveLean: "neutral", reconciled: "none" };
}

/** The readiness module score relevant to a program type, GTM folded as a floor.
 *  Returns null when no relevant module was scored (degrades by renormalization). */
function readinessTermFor(programType: string, r: RecommendReadiness): number | null {
  const pt = norm(programType);
  const typeModule =
    pt === "competency" || pt === "service delivery"
      ? r.competency
      : pt === "specialization"
        ? r.specialization
        : r.gtm; // Program / Tier lean on GTM readiness
  let term: number | undefined;
  if (typeModule !== undefined && r.gtm !== undefined) term = (typeModule + r.gtm) / 2;
  else term = typeModule ?? r.gtm;
  return term ?? null;
}

function businessTone(term: number): RationaleTone {
  if (term >= 70) return "ok";
  if (term >= 30) return "info";
  return "neutral";
}
function readinessTone(term: number): RationaleTone {
  if (term >= 75) return "ok";
  if (term >= 60) return "info";
  return "warn";
}

/** Rank EVERY program in the supplied fits (keep unfiltered for testability; the
 *  loader/UI filter to Competency + Specialization + Service Delivery). */
export function recommendCompetencies(input: RecommendInput): CompetencyRecommendation[] {
  const evidenceLean: PartnerLean = input.fits[0]?.lean ?? "neutral";
  const { declaredLean, effectiveLean, reconciled } = reconcileLean(input.profile, evidenceLean);
  const hasProfile = input.profile.partnerType !== null || input.profile.industry !== null;

  const out = input.fits.map((fit): CompetencyRecommendation => {
    const coverageTerm = fit.coveragePercent;
    const businessModelTerm = clamp(
      (deliveryAligns(effectiveLean, fit.deliveryModel) ? DELIVERY_ALIGN_POINTS : 0) +
        (typeAligns(effectiveLean, fit.programType) ? TYPE_ALIGN_POINTS : 0) +
        (REC_FUNDING_POINTS[norm(fit.fundingFit)] ?? 0),
    );

    let readinessTerm = readinessTermFor(fit.programType, input.readiness);
    const targetMatched =
      readinessTerm !== null && normalizedIncludes(input.readiness.targetProgram, fit.name);
    if (targetMatched && readinessTerm !== null) readinessTerm = clamp(readinessTerm + TARGET_BOOST);
    const hasReadiness = readinessTerm !== null;

    // Renormalize weights over present terms (coverage + business always present).
    const wCov = REC_COVERAGE_WEIGHT;
    const wBus = REC_BUSINESS_WEIGHT;
    const wRead = hasReadiness ? REC_READINESS_WEIGHT : 0;
    const W = wCov + wBus + wRead;
    const score = clamp(
      Math.round((wCov * coverageTerm + wBus * businessModelTerm + wRead * (readinessTerm ?? 0)) / W),
    );

    // Rationale chips (honest about missing inputs).
    const rationale: RationaleChip[] = [];
    rationale.push(
      coverageTerm <= 0
        ? { kind: "evidence", label: "No evidence yet", detail: `${fit.gapCount} requirement gaps`, tone: "neutral" }
        : {
            kind: "evidence",
            label: `Evidence ${coverageTerm}%`,
            detail: `${fit.metCount} met / ${fit.partialCount} partial / ${fit.gapCount} gap`,
            tone: coverageTerm >= 60 ? "ok" : "info",
          },
    );
    if (!hasProfile) {
      rationale.push({ kind: "business_model", label: "Business model not set", detail: "Add it in onboarding to sharpen ranking", tone: "neutral" });
    } else if (effectiveLean === "neutral") {
      rationale.push({ kind: "business_model", label: "Generalist", detail: "No single business-model lean", tone: "neutral" });
    } else {
      const basis = reconciled === "evidence_only" ? "from evidence" : reconciled === "declared_wins" && declaredLean !== evidenceLean ? "declared, overrides thin evidence" : "declared";
      rationale.push({
        kind: "business_model",
        label: `Business model: ${LEAN_LABELS[effectiveLean]}`,
        detail: `${businessModelTerm}/100 alignment (${basis})`,
        tone: businessTone(businessModelTerm),
      });
    }
    if (hasReadiness && readinessTerm !== null) {
      rationale.push({ kind: "readiness", label: `Readiness ${Math.round(readinessTerm)}`, detail: "GTM / competency assessment", tone: readinessTone(readinessTerm) });
    } else {
      rationale.push({ kind: "readiness", label: "Readiness not yet assessed", detail: "Run a readiness assessment to refine", tone: "neutral" });
    }
    if (targetMatched) {
      rationale.push({ kind: "target", label: "Your assessment targets this", detail: "Named as the target program", tone: "ok" });
    }
    if (norm(fit.fundingFit) === "high") {
      rationale.push({ kind: "funding", label: "High funding fit", detail: "AWS funding likely supports this", tone: "info" });
    }

    return {
      programKey: fit.programKey,
      name: fit.name,
      programType: fit.programType,
      deliveryModel: fit.deliveryModel,
      fundingFit: fit.fundingFit,
      recommendationScore: score,
      band: fitBand(score),
      coveragePercent: coverageTerm,
      evidenceFitScore: fit.fitScore,
      declaredLean,
      evidenceLean,
      effectiveLean,
      leanReconciled: reconciled,
      isAdopted: input.adoptedKeys.has(fit.programKey),
      rationale,
      components: {
        coverageTerm,
        businessModelTerm,
        readinessTerm,
        weights: { coverage: wCov / W, businessModel: wBus / W, readiness: wRead / W },
      },
    };
  });

  return out.sort(
    (a, b) =>
      b.recommendationScore - a.recommendationScore ||
      b.coveragePercent - a.coveragePercent ||
      a.programKey.localeCompare(b.programKey),
  );
}

/** Program types surfaced as competency recommendations (the rest still rank, for tests). */
export const RECOMMENDED_TYPES: readonly string[] = ["competency", "specialization", "service delivery"];

export function isRecommendedType(programType: string): boolean {
  return RECOMMENDED_TYPES.includes(norm(programType));
}
