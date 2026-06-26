import { planSummary } from "@/domain/tiers/gap";
import { healthScore, type Health } from "@/domain/command/health";
import {
  deriveDecisions,
  workSummary,
  type Decision,
  type WorkSummary,
} from "@/domain/command/brief";
import type { CommandInputs } from "@/domain/command/types";

/**
 * Pure composition of the Command Center model: health score, the decision
 * queue, work summary, and progress. No database — the caller passes the
 * aggregated inputs and `today`. This is the single entry point the page (and
 * the executive packet export) renders from.
 */

export interface CommandProgress {
  readonly programsActive: number;
  readonly programsTotal: number;
  readonly tasksDone: number;
  readonly tasksTotal: number;
  readonly tierPercent: number | null;
}

export interface CommandCenter {
  readonly health: Health;
  readonly work: WorkSummary;
  readonly decisions: readonly Decision[];
  readonly topRisk: Decision | null;
  readonly requiredDecision: Decision | null;
  readonly progress: CommandProgress;
}

export function buildCommandCenter(
  inputs: CommandInputs,
  today: string,
): CommandCenter {
  const decisions = deriveDecisions(inputs, today);
  const work = workSummary(inputs.tasks, today);
  const tier = inputs.tier ? planSummary(inputs.tierRequirements) : null;

  return {
    health: healthScore(inputs, today),
    work,
    decisions,
    topRisk: decisions[0] ?? null,
    // The required decision is the most urgent item that has a named owner; if
    // none is owned, fall back to the top risk.
    requiredDecision: decisions.find((d) => d.ownerUserId !== null) ?? decisions[0] ?? null,
    progress: {
      programsActive: inputs.programs.filter((p) => p.status === "active").length,
      programsTotal: inputs.programs.length,
      tasksDone: inputs.tasks.filter((t) => t.status === "done").length,
      tasksTotal: inputs.tasks.length,
      tierPercent: tier ? tier.percent : null,
    },
  };
}
