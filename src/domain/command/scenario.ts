import { baselineFor, projectImpact, type ImpactDelta } from "@/domain/command/impact";
import { buildCandidates, type Effort } from "@/domain/command/next-best-action";
import { healthScore, type Health } from "@/domain/command/health";
import { deriveDecisions } from "@/domain/command/brief";
import { planSummary } from "@/domain/tiers/gap";
import type { CommandInputs } from "@/domain/command/types";

/**
 * Pure multi-move scenario composer: chain SELECTED what-if candidates (the same
 * immutable transforms the Next-Best-Action ranker projects one at a time) and
 * measure the stacked effect — "do these four things → health 71 → 84". Candidates
 * are applied in their stable enumeration order (buildCandidates), so the URL's key
 * order can never change the outcome. Projections only rank; they never write.
 */

export interface ScenarioState {
  readonly health: number;
  readonly band: Health["band"];
  readonly tierPct: number;
  readonly queueLen: number;
}

export interface ScenarioStep {
  readonly key: string;
  readonly title: string;
  readonly category: string;
  readonly effort: Effort;
  /** Impact of the scenario UP TO AND INCLUDING this step (vs the baseline). */
  readonly cumulative: ImpactDelta;
}

export interface Scenario {
  readonly baseline: ScenarioState;
  readonly result: ScenarioState;
  /** Total stacked impact (equals the last step's cumulative). */
  readonly delta: ImpactDelta;
  readonly steps: readonly ScenarioStep[];
  /** Keys actually applied, in application order. */
  readonly appliedKeys: readonly string[];
  /** Requested keys that no longer match a live candidate (acted on since the link). */
  readonly droppedKeys: readonly string[];
}

const ZERO: ImpactDelta = { healthDelta: 0, tierPctDelta: 0, queueDelta: 0 };

export function composeScenario(
  inputs: CommandInputs,
  keys: readonly string[],
  today: string,
): Scenario {
  const keySet = new Set(keys);
  const selected = buildCandidates(inputs, today).filter((c) => keySet.has(c.key));
  const appliedKeys = selected.map((c) => c.key);
  const appliedSet = new Set(appliedKeys);
  const droppedKeys = [...new Set(keys)].filter((k) => !appliedSet.has(k));

  const base = baselineFor(inputs, today);
  const baseline: ScenarioState = {
    health: base.healthScore,
    band: healthScore(inputs, today).band,
    tierPct: base.tierPct,
    queueLen: base.queueLen,
  };

  let current = inputs;
  const steps: ScenarioStep[] = [];
  for (const c of selected) {
    current = c.apply(current);
    steps.push({
      key: c.key,
      title: c.title,
      category: c.category,
      effort: c.effort,
      cumulative: projectImpact(base, current, today),
    });
  }

  const after = healthScore(current, today);
  const result: ScenarioState = {
    health: after.score,
    band: after.band,
    tierPct: current.tier ? planSummary(current.tierRequirements).percent : 0,
    queueLen: deriveDecisions(current, today).length,
  };

  return {
    baseline,
    result,
    delta: steps.length > 0 ? steps[steps.length - 1]!.cumulative : ZERO,
    steps,
    appliedKeys,
    droppedKeys,
  };
}
