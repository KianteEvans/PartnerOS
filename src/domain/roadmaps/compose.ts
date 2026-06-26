import { PROGRAM_LIBRARY } from "@/domain/programs/library";
import { thresholdsForTier, TIER_LABELS, type TierId } from "@/domain/tiers/catalog";

/**
 * Pure roadmap composition: turn a customer's selection of differentiators — the
 * AWS programs/competencies they want to earn plus the partner tier they want to
 * reach — into an ordered set of milestone seeds. No database, no clock; the same
 * function runs server-side (to persist) and client-side (for the builder's live
 * preview), so the preview can never drift from what gets created.
 *
 * Granularity is deliberate: a program/competency is one ownable milestone (a
 * single submission someone drives), while tier advancement fans out into one
 * milestone per threshold requirement — certifications, launched opportunities,
 * and references are genuinely separate workstreams with different owners.
 */

export interface ComposeSelection {
  readonly programKeys: readonly string[];
  readonly targetTier: TierId | null;
}

export interface ComposedMilestone {
  /** Stable identity across re-composition; the key owner assignments map by. */
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly originKind: "program" | "tier";
  readonly originLabel: string;
  /**
   * Catalog key this milestone advances — the program library key, or
   * "<tier>:<requirementKey>" — so finalize can adopt it and the detail page can
   * roll real progress back onto the milestone.
   */
  readonly originRef: string;
}

/** Build the ordered milestone seeds for a selection: programs first, then tier. */
export function composeMilestones(
  selection: ComposeSelection,
): ComposedMilestone[] {
  const out: ComposedMilestone[] = [];
  const selected = new Set(selection.programKeys);

  // Programs in catalog order — one ownable milestone per program/competency.
  for (const p of PROGRAM_LIBRARY) {
    if (!selected.has(p.key)) continue;
    const reqs = p.requirements.map((r) => r.label).join("; ");
    out.push({
      key: `program:${p.key}`,
      title: `Earn ${p.name}`,
      detail: reqs ? `${p.description} Requires: ${reqs}.` : p.description,
      originKind: "program",
      originLabel: p.name,
      originRef: p.key,
    });
  }

  // Tier advancement — one milestone per threshold requirement. thresholdsForTier
  // returns [] for 'registered' (not an advancement target), so that yields none.
  const target = selection.targetTier;
  if (target) {
    const tierLabel = `${TIER_LABELS[target]} tier`;
    for (const t of thresholdsForTier(target)) {
      out.push({
        key: `tier:${target}:${t.key}`,
        title: `${tierLabel}: ${t.label}`,
        detail: `Reach ${t.threshold} ${t.unit}.`,
        originKind: "tier",
        originLabel: tierLabel,
        originRef: `${target}:${t.key}`,
      });
    }
  }

  return out;
}
