/**
 * Pure evidence-selection for grounding an AI control response. Self-assessment
 * controls are FREE-TEXT (no expectedEvidenceType), so matching is fuzzy: keyword
 * overlap between the requirement+section and each evidence item's title+notes,
 * weighted by approval status and a small evidence-type-keyword boost. Bounds the
 * set so the prompt stays small. No DB/clock — unit-tested.
 */

export interface GroundingEvidence {
  readonly id: string;
  readonly title: string;
  readonly notes: string;
  readonly evidenceType: string;
  readonly status: string;
  readonly qualityScore: number | null;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "by", "is", "are",
  "be", "as", "at", "that", "this", "their", "they", "our", "we", "partner", "aws", "customer",
  "must", "should", "provide", "provides", "have", "has", "how", "when", "include", "includes",
]);

const EVIDENCE_TYPE_WORDS: Record<string, readonly string[]> = {
  case_study: ["case", "study", "reference", "example", "success"],
  certification: ["certif", "trained", "staff", "expertise", "accredit"],
  architecture: ["architecture", "design", "diagram", "technical", "solution", "implementation"],
  security: ["security", "secure", "compliance", "control", "threat", "encryption"],
  billing: ["marketplace", "billing", "listing", "revenue", "saas"],
  reference: ["reference", "satisfaction", "launched", "opportunity", "testimonial"],
};

/** Shared keyword tokenizer (also used by ace/case-study-match.ts). */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export const STATUS_WEIGHT: Record<string, number> = {
  approved: 8,
  in_review: 3,
  collected: 1,
};

/**
 * Relevance of one evidence item to a control. Keyword overlap (title/notes/type
 * vs requirement) and a type-topic boost determine RELEVANCE; status + quality
 * only REFINE the ranking of relevant items. Zero-overlap evidence scores 0 so the
 * "fall back to top approved" path can fire when nothing genuinely matches.
 */
export function scoreEvidence(
  requirement: string,
  section: string,
  ev: GroundingEvidence,
): number {
  const want = new Set(tokens(`${requirement} ${section}`));
  const have = tokens(`${ev.title} ${ev.notes} ${ev.evidenceType}`);
  const matched = new Set<string>();
  for (const w of have) if (want.has(w)) matched.add(w);
  const reqLower = `${requirement} ${section}`.toLowerCase();
  const typeWords = EVIDENCE_TYPE_WORDS[ev.evidenceType] ?? [];
  const typeBoost = typeWords.some((w) => reqLower.includes(w)) ? 5 : 0;
  const relevance = matched.size * 10 + typeBoost;
  if (relevance === 0) return 0;
  let score = relevance + (STATUS_WEIGHT[ev.status] ?? 0);
  if (ev.qualityScore !== null) score += Math.round(ev.qualityScore / 20);
  return score;
}

export interface SelectOpts {
  readonly maxItems?: number;
  readonly notesCap?: number;
}

/**
 * Pick a bounded, relevance-ranked evidence set for a control. Falls back to the
 * top approved evidence when nothing scores, so the model can still correctly
 * conclude "insufficient evidence -> not met". Truncates notes to bound tokens.
 */
export function selectEvidenceForControl(
  requirement: string,
  section: string,
  evidence: readonly GroundingEvidence[],
  opts?: SelectOpts,
): GroundingEvidence[] {
  const maxItems = opts?.maxItems ?? 8;
  const notesCap = opts?.notesCap ?? 400;

  const scored = evidence
    .map((ev) => ({ ev, s: scoreEvidence(requirement, section, ev) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  let chosen = scored.slice(0, maxItems).map((x) => x.ev);
  if (chosen.length === 0) {
    chosen = evidence
      .filter((e) => e.status === "approved")
      .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
      .slice(0, Math.min(3, maxItems));
  }

  return chosen.map((e) => ({
    ...e,
    notes: e.notes.length > notesCap ? `${e.notes.slice(0, notesCap)}...` : e.notes,
  }));
}
