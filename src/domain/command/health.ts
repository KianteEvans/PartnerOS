import { completeness } from "@/domain/evidence/inventory";
import { portfolioSummary } from "@/domain/mdf/analytics";
import { pipelineSummary } from "@/domain/ace/opportunities";
import { planSummary } from "@/domain/tiers/gap";
import type { CommandInputs } from "@/domain/command/types";

/**
 * Pure partnership health score: a weighted blend of per-section component
 * scores, each computed by reusing that section's pure summary. No database, no
 * clock — the caller passes `today`. Deterministic and unit-testable. A section
 * with no data scores a neutral 70 so an empty workspace isn't penalized.
 */

export type HealthBand = "strong" | "fair" | "at_risk";

export interface HealthDriver {
  readonly label: string;
  readonly score: number;
}

export interface Health {
  readonly score: number;
  readonly band: HealthBand;
  readonly drivers: readonly HealthDriver[];
}

const NEUTRAL = 70;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Per-driver weights for the composite health score. Exported so the Partnership
 * Graph can render the causal decomposition (each driver's edge to health is weighted
 * by its WEIGHT) without duplicating the numbers.
 */
export const WEIGHTS = {
  evidence: 0.2,
  mdf: 0.15,
  ace: 0.2,
  programs: 0.15,
  tasks: 0.2,
  tier: 0.1,
} as const;

export type DriverWeightKey = keyof typeof WEIGHTS;

export function healthScore(inputs: CommandInputs, today: string): Health {
  const ev = completeness(inputs.evidence);
  const mdf = portfolioSummary(inputs.mdf, today);
  const ace = pipelineSummary(inputs.opportunities, today);
  const tier = planSummary(inputs.tierRequirements);

  const evidence = inputs.evidence.length > 0 ? ev.percent : NEUTRAL;
  const mdfScore = inputs.mdf.length > 0 ? clamp(100 - mdf.deadlineRisks * 25) : NEUTRAL;
  const aceScore =
    ace.open > 0 ? clamp(100 - (ace.atRisk / ace.open) * 100) : NEUTRAL;

  const progTotal = inputs.programs.length;
  const active = inputs.programs.filter((p) => p.status === "active").length;
  const pending = inputs.programs.filter(
    (p) => p.status === "pending" || p.status === "submitted",
  ).length;
  const programs =
    progTotal > 0 ? clamp(((active + 0.5 * pending) / progTotal) * 100) : NEUTRAL;

  const openTasks = inputs.tasks.filter((t) => t.status !== "done").length;
  const overdue = inputs.tasks.filter(
    (t) => t.status !== "done" && t.dueDate !== null && t.dueDate < today,
  ).length;
  const tasks = openTasks > 0 ? clamp(100 - (overdue / openTasks) * 100) : NEUTRAL;

  const tierScore = inputs.tier ? tier.percent : NEUTRAL;

  const score = clamp(
    evidence * WEIGHTS.evidence +
      mdfScore * WEIGHTS.mdf +
      aceScore * WEIGHTS.ace +
      programs * WEIGHTS.programs +
      tasks * WEIGHTS.tasks +
      tierScore * WEIGHTS.tier,
  );

  const band: HealthBand = score >= 75 ? "strong" : score >= 50 ? "fair" : "at_risk";

  return {
    score,
    band,
    drivers: [
      { label: "Evidence", score: evidence },
      { label: "MDF", score: mdfScore },
      { label: "ACE", score: aceScore },
      { label: "Programs", score: programs },
      { label: "Tasks", score: tasks },
      { label: "Tier", score: tierScore },
    ],
  };
}
