import { tokens } from "@/domain/applications/grounding";

/**
 * Deterministic opportunity -> case-study relevance. Runs at read time on the
 * Deal Desk (materialize-on-read; no upload-time hook needed), so every
 * opportunity — partner-originated, Amazon-originated, or Partner Central
 * synced — gets matches the moment it is viewed. Attached (rep-pinned) studies
 * always surface, sorted first; unattached ones must clear a relevance
 * threshold and are capped. Reasons are deterministic chips, not prose — the
 * optional AI rationale layers on top without changing the ranking.
 */

export interface MatchOpp {
  readonly name: string;
  readonly accountName: string;
  readonly nextStep: string;
  readonly awsNextBestActions: string;
  /** Linked solution text (title + description + selling proposition), "" when unlinked. */
  readonly solutionText: string;
  /** Linked program text (name + program type), "" when unlinked. */
  readonly programText: string;
}

export interface MatchCaseStudy {
  readonly id: string;
  readonly title: string;
  readonly customerName: string;
  /** The five narrative aspects concatenated. */
  readonly aspectsText: string;
  /** 0-100 from caseStudyCompleteness().percent. */
  readonly completenessPercent: number;
  readonly hasEvidence: boolean;
}

export interface ScoredCaseStudy {
  readonly id: string;
  readonly title: string;
  readonly customerName: string;
  readonly score: number;
  /** Deterministic reason chips, strongest first. */
  readonly reasons: readonly string[];
  readonly attached: boolean;
}

export interface MatchOpts {
  /** Minimum score for an UNATTACHED study to appear. */
  readonly threshold?: number;
  /** Cap on unattached matches shown (attached are always included). */
  readonly maxUnattached?: number;
}

const SAME_CUSTOMER_BOOST = 25;
const OVERLAP_WEIGHT = 10;
/** Cap counted keyword matches — aspects are long prose; a wall of text must not drown the customer signal. */
const OVERLAP_CAP = 8;
const EVIDENCE_BOOST = 3;
const DEFAULT_THRESHOLD = 15;
const DEFAULT_MAX_UNATTACHED = 5;
const REASON_KEYWORDS_SHOWN = 3;

function sameCustomer(accountName: string, customerName: string): boolean {
  const a = accountName.trim().toLowerCase();
  const c = customerName.trim().toLowerCase();
  if (a.length < 3 || c.length < 3) return false;
  return a.includes(c) || c.includes(a);
}

function scoreStudy(opp: MatchOpp, study: MatchCaseStudy): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (sameCustomer(opp.accountName, study.customerName)) {
    score += SAME_CUSTOMER_BOOST;
    reasons.push("Same customer");
  }

  const want = new Set(
    tokens(
      `${opp.name} ${opp.accountName} ${opp.nextStep} ${opp.awsNextBestActions} ${opp.solutionText} ${opp.programText}`,
    ),
  );
  const have = tokens(`${study.title} ${study.customerName} ${study.aspectsText}`);
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const w of have) {
    if (want.has(w) && !seen.has(w)) {
      seen.add(w);
      matched.push(w);
    }
  }
  if (matched.length > 0) {
    score += Math.min(matched.length, OVERLAP_CAP) * OVERLAP_WEIGHT;
    const shown = matched.slice(0, REASON_KEYWORDS_SHOWN).join(", ");
    reasons.push(
      matched.length === 1 ? `Shared keyword: ${shown}` : `${matched.length} shared keywords: ${shown}`,
    );
  }

  // Only differentiate studies that are already relevant — quality alone never
  // clears the threshold.
  if (score > 0) {
    score += Math.round(study.completenessPercent / 20);
    if (study.completenessPercent === 100) reasons.push("Complete write-up");
    if (study.hasEvidence) {
      score += EVIDENCE_BOOST;
      reasons.push("Evidence-backed");
    }
  }

  return { score, reasons };
}

export function matchCaseStudies(
  opp: MatchOpp,
  studies: readonly MatchCaseStudy[],
  attachedIds: ReadonlySet<string>,
  opts?: MatchOpts,
): ScoredCaseStudy[] {
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const maxUnattached = opts?.maxUnattached ?? DEFAULT_MAX_UNATTACHED;

  const scored = studies.map((s) => {
    const { score, reasons } = scoreStudy(opp, s);
    return {
      id: s.id,
      title: s.title,
      customerName: s.customerName,
      score,
      reasons,
      attached: attachedIds.has(s.id),
    };
  });

  const byRank = (a: ScoredCaseStudy, b: ScoredCaseStudy): number =>
    b.score - a.score || a.title.localeCompare(b.title);

  const attached = scored.filter((s) => s.attached).sort(byRank);
  const suggested = scored
    .filter((s) => !s.attached && s.score >= threshold)
    .sort(byRank)
    .slice(0, maxUnattached);

  return [...attached, ...suggested];
}
