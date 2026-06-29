import { questionsForModule, type ModuleId } from "@/domain/assessments/catalog";
import {
  GAP_THRESHOLD,
  STRENGTH_THRESHOLD,
  type ResponseMap,
  type ScoredModule,
} from "@/domain/assessments/scoring";

/**
 * Pure presentational helpers for the Readiness Assessment results page: banding,
 * the per-module gap diagnostic, and period-over-period (re-assessment) deltas.
 * No DB, no clock — deterministic and unit-testable, mirroring the reports
 * health/delta helpers (`healthFromSnapshot` / `snapshotDelta`).
 */

export type OverallBand = "strong" | "fair" | "at_risk";

/** Headline band for the overall score, mirroring the reports health bands. */
export function overallBand(score: number): OverallBand {
  if (score >= STRENGTH_THRESHOLD) return "strong";
  if (score >= GAP_THRESHOLD) return "fair";
  return "at_risk";
}

export type ModuleBand = "strength" | "on_track" | "gap";

/** Per-module band, reusing the scoring thresholds: >=75 strength, <60 gap. */
export function moduleBand(score: number): ModuleBand {
  if (score >= STRENGTH_THRESHOLD) return "strength";
  if (score < GAP_THRESHOLD) return "gap";
  return "on_track";
}

export interface WeakQuestion {
  readonly key: string;
  readonly prompt: string;
  /** Score (0–100) of the chosen answer; 0 if unanswered/unrecognized. */
  readonly score: number;
  /** Label of the chosen option, or "Not answered". */
  readonly answerLabel: string;
}

/**
 * The lowest-scoring questions in a module, worst first — the concrete diagnostic
 * behind a module gap. Generalizes scoring.ts's private `weakestQuestionKeys` so
 * the results page can name *what* dragged the module down (prompt + the chosen
 * answer + its score). Ties break by key for stability.
 */
export function weakestQuestions(
  module: ModuleId,
  responses: ResponseMap,
  limit = 2,
): WeakQuestion[] {
  return questionsForModule(module)
    .map((q) => {
      const value = responses.get(q.key);
      const option =
        value === undefined ? undefined : q.options.find((o) => o.value === value);
      return {
        key: q.key,
        prompt: q.prompt,
        score: option ? option.score : 0,
        answerLabel: option ? option.label : "Not answered",
      };
    })
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export interface ModuleDelta {
  readonly module: ModuleId;
  readonly current: number;
  readonly prior: number | null;
  readonly delta: number | null;
}

/**
 * Per-module change vs the immediately-prior scored assessment of the same preset.
 * Modules are matched by id; a module absent from the prior (or `prior=null`, i.e.
 * the first assessment of its type) yields a null delta.
 */
export function moduleDeltas(
  current: readonly ScoredModule[],
  prior: readonly ScoredModule[] | null,
): ModuleDelta[] {
  const priorByModule = prior
    ? new Map(prior.map((m) => [m.module, m.score]))
    : null;
  return current.map((m) => {
    const p = priorByModule?.get(m.module) ?? null;
    return {
      module: m.module,
      current: m.score,
      prior: p,
      delta: p === null ? null : m.score - p,
    };
  });
}

/** Trivial scalar delta used for the overall-score chip; null when no prior. */
export function deltaOf(current: number, prior: number | null): number | null {
  return prior === null ? null : current - prior;
}
