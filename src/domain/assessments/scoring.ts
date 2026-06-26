import {
  getQuestion,
  questionsForModule,
  type ModuleId,
} from "@/domain/assessments/catalog";

/**
 * Pure, deterministic scoring. No database, no I/O — given the in-scope modules
 * and a map of answers, it returns the same result every time, which is what
 * makes both the unit tests and `assessments.catalog_version` meaningful.
 *
 * Module score = weighted average of its questions' option scores. An
 * unanswered (or unrecognized) answer contributes 0, so an empty draft scores 0
 * and surfaces every module as a gap — completing the assessment raises it.
 * Overall = the unweighted mean of the in-scope module scores.
 */

/** A module scoring at or above this is reported as a strength. */
export const STRENGTH_THRESHOLD = 75;
/** A module scoring below this is reported as a gap. */
export const GAP_THRESHOLD = 60;

export interface ScoredModule {
  readonly module: ModuleId;
  readonly score: number;
}

export interface ModuleGap {
  readonly module: ModuleId;
  readonly score: number;
  /** Keys of the lowest-scoring questions driving the gap, worst first. */
  readonly weakestQuestionKeys: readonly string[];
}

export interface ScoreResult {
  readonly overall: number;
  readonly modules: readonly ScoredModule[];
  /** In-scope modules at/above the strength threshold, worst-to-best removed. */
  readonly strengths: readonly ModuleId[];
  readonly gaps: readonly ModuleGap[];
}

/** Map of question_key -> stored answer value. */
export type ResponseMap = ReadonlyMap<string, string>;

function clampScore(n: number): number {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

/** Score of a single answered question (0 if unanswered/unrecognized). */
function questionScore(key: string, responses: ResponseMap): number {
  const question = getQuestion(key);
  if (!question) return 0;
  const value = responses.get(key);
  if (value === undefined) return 0;
  const option = question.options.find((o) => o.value === value);
  return option ? option.score : 0;
}

function scoreModule(module: ModuleId, responses: ResponseMap): number {
  const questions = questionsForModule(module);
  const totalWeight = questions.reduce((sum, q) => sum + q.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = questions.reduce(
    (sum, q) => sum + q.weight * questionScore(q.key, responses),
    0,
  );
  return clampScore(weighted / totalWeight);
}

/** The two or three weakest questions in a module, worst first. */
function weakestQuestionKeys(
  module: ModuleId,
  responses: ResponseMap,
): readonly string[] {
  return questionsForModule(module)
    .map((q) => ({ key: q.key, score: questionScore(q.key, responses) }))
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key))
    .slice(0, 2)
    .map((q) => q.key);
}

export function scoreAssessment(
  modules: readonly ModuleId[],
  responses: ResponseMap,
): ScoreResult {
  const scored: ScoredModule[] = modules.map((module) => ({
    module,
    score: scoreModule(module, responses),
  }));

  const overall =
    scored.length === 0
      ? 0
      : clampScore(
          scored.reduce((sum, m) => sum + m.score, 0) / scored.length,
        );

  const strengths = scored
    .filter((m) => m.score >= STRENGTH_THRESHOLD)
    .map((m) => m.module);

  const gaps: ModuleGap[] = scored
    .filter((m) => m.score < GAP_THRESHOLD)
    .sort((a, b) => a.score - b.score)
    .map((m) => ({
      module: m.module,
      score: m.score,
      weakestQuestionKeys: weakestQuestionKeys(m.module, responses),
    }));

  return { overall, modules: scored, strengths, gaps };
}
