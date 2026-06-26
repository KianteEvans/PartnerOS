import {
  MODULE_LABELS,
  type ModuleId,
  type PresetId,
} from "@/domain/assessments/catalog";
import {
  GAP_THRESHOLD,
  STRENGTH_THRESHOLD,
  type ScoreResult,
} from "@/domain/assessments/scoring";

/**
 * Pure recommendation generation: a scored assessment in, a deterministic list
 * of recommendation drafts out. These are the approval-gated downstream actions
 * — they are staged as `pending` and only a human review moves them forward.
 *
 * Rules are intentionally simple and explainable (the product is "grounded in
 * workspace data and source provenance, not generic chatbot output"):
 *   - every gap module yields a `task` to close it (confidence scales with the
 *     size of the gap);
 *   - an evidence gap additionally yields an `evidence_gap` recommendation;
 *   - the single worst module yields a `milestone`;
 *   - the target program (if any) yields a `program` recommendation whose tone
 *     depends on whether the overall score clears the strength threshold.
 * Output order is stable (gaps worst-first, then milestone, then program) so
 * the unit tests are deterministic.
 */

export type RecommendationType =
  | "program"
  | "evidence_gap"
  | "task"
  | "milestone";

export interface RecommendationDraft {
  readonly type: RecommendationType;
  readonly title: string;
  readonly detail: string;
  readonly payload: Record<string, unknown>;
  readonly confidence: number;
}

export interface RecommendationContext {
  readonly preset: PresetId;
  readonly targetProgram: string | null;
}

function clampConfidence(n: number): number {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

export function generateRecommendations(
  result: ScoreResult,
  ctx: RecommendationContext,
): readonly RecommendationDraft[] {
  const drafts: RecommendationDraft[] = [];

  // One task per gap module; bigger gap -> higher confidence it needs work.
  for (const gap of result.gaps) {
    const label = MODULE_LABELS[gap.module];
    drafts.push({
      type: "task",
      title: `Close ${label} gap`,
      detail: `${label} scored ${gap.score}/100, below the ${GAP_THRESHOLD} readiness bar. Address the weakest areas to raise it.`,
      payload: {
        module: gap.module,
        score: gap.score,
        weakestQuestionKeys: gap.weakestQuestionKeys,
      },
      confidence: clampConfidence(GAP_THRESHOLD + (GAP_THRESHOLD - gap.score)),
    });
  }

  // An evidence gap is called out separately — it blocks program submission.
  const evidenceGap = result.gaps.find((g) => g.module === "evidence");
  if (evidenceGap) {
    drafts.push({
      type: "evidence_gap",
      title: "Resolve evidence gaps before submission",
      detail: `Evidence Readiness scored ${evidenceGap.score}/100. Collect and refresh the required artifacts so submissions are not blocked.`,
      payload: {
        module: "evidence",
        score: evidenceGap.score,
        weakestQuestionKeys: evidenceGap.weakestQuestionKeys,
      },
      confidence: clampConfidence(70 + (GAP_THRESHOLD - evidenceGap.score) / 2),
    });
  }

  // The single worst module becomes a milestone to sequence the work — but only
  // if it isn't already strong (no milestone to "reach 75+" on a 100/100 area).
  const worst = lowestModule(result);
  if (worst && worst.score < STRENGTH_THRESHOLD) {
    drafts.push({
      type: "milestone",
      title: `Reach ${STRENGTH_THRESHOLD}+ in ${MODULE_LABELS[worst.module]}`,
      detail: `${MODULE_LABELS[worst.module]} is the lowest-scoring area at ${worst.score}/100. Make it a near-term roadmap milestone.`,
      payload: { module: worst.module, fromScore: worst.score, toScore: STRENGTH_THRESHOLD },
      confidence: 80,
    });
  }

  // A program recommendation framed by overall readiness.
  if (ctx.targetProgram) {
    const ready = result.overall >= STRENGTH_THRESHOLD;
    drafts.push({
      type: "program",
      title: ready
        ? `Submit for ${ctx.targetProgram}`
        : `Build readiness for ${ctx.targetProgram}`,
      detail: ready
        ? `Overall readiness is ${result.overall}/100. You appear ready to prepare a ${ctx.targetProgram} submission packet.`
        : `Overall readiness is ${result.overall}/100, below the ${STRENGTH_THRESHOLD} bar. Close the gaps above before submitting for ${ctx.targetProgram}.`,
      payload: { targetProgram: ctx.targetProgram, overall: result.overall, ready },
      confidence: ready
        ? clampConfidence(result.overall)
        : clampConfidence(100 - result.overall),
    });
  }

  return drafts;
}

function lowestModule(
  result: ScoreResult,
): { module: ModuleId; score: number } | null {
  let lowest: { module: ModuleId; score: number } | null = null;
  for (const m of result.modules) {
    if (lowest === null || m.score < lowest.score) lowest = m;
  }
  return lowest;
}
