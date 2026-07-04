import { healthScore } from "@/domain/command/health";
import { deriveDecisions } from "@/domain/command/brief";
import { planSummary } from "@/domain/tiers/gap";
import type { CommandInputs } from "@/domain/command/types";

/**
 * Pure "what-if" impact engine: apply a candidate action to the Command Center
 * inputs (immutably) and measure the projected impact by re-running the SAME pure
 * engines the dashboard already uses (health score, decision queue, tier %). No
 * database, no clock, no mutation — the caller passes `today`. This is the shared
 * foundation the Next-Best-Action ranker (and the later Path-Simulator / Copilot /
 * Graph initiatives) build on. Projections only rank; they never write.
 */

export interface ImpactDelta {
  /** Change in the 0–100 partnership health score (positive = better). */
  readonly healthDelta: number;
  /** Change in tier-readiness percent (positive = closer to target tier). */
  readonly tierPctDelta: number;
  /** Fewer open decisions after the action (positive = fewer alerts). */
  readonly queueDelta: number;
}

export interface ImpactBaseline {
  readonly healthScore: number;
  readonly queueLen: number;
  readonly tierPct: number;
}

/** Snapshot the "before" once so each candidate only recomputes the "after" side. */
export function baselineFor(inputs: CommandInputs, today: string): ImpactBaseline {
  return {
    healthScore: healthScore(inputs, today).score,
    queueLen: deriveDecisions(inputs, today).length,
    tierPct: inputs.tier ? planSummary(inputs.tierRequirements).percent : 0,
  };
}

export function projectImpact(
  baseline: ImpactBaseline,
  next: CommandInputs,
  today: string,
): ImpactDelta {
  const nextTierPct = next.tier ? planSummary(next.tierRequirements).percent : 0;
  return {
    healthDelta: healthScore(next, today).score - baseline.healthScore,
    tierPctDelta: nextTierPct - baseline.tierPct,
    queueDelta: baseline.queueLen - deriveDecisions(next, today).length,
  };
}

// --- Immutable copy-on-write action transforms ------------------------------
// Each flips exactly the field(s) the corresponding deriveDecisions/healthScore
// predicate reads, so applying it removes that decision + moves its driver. The
// unit tests assert this (queueDelta > 0), so a wrong transform fails loudly.

/** Resolve an open/blocked/overdue task → done. */
export function resolveTask(inputs: CommandInputs, id: string): CommandInputs {
  return {
    ...inputs,
    tasks: inputs.tasks.map((t) => (t.id === id ? { ...t, status: "done" as const } : t)),
  };
}

/** Land an at-risk opportunity → won (status "won" removes it from isAtRisk). */
export function winOpp(inputs: CommandInputs, id: string): CommandInputs {
  return {
    ...inputs,
    opportunities: inputs.opportunities.map((o) =>
      o.id === id ? { ...o, status: "won" as const, stage: "launched" as const } : o,
    ),
  };
}

/** Approve a piece of evidence and clear its expiry (removes isExpiringSoon). */
export function approveEvidence(inputs: CommandInputs, id: string): CommandInputs {
  return {
    ...inputs,
    evidence: inputs.evidence.map((e) =>
      e.id === id ? { ...e, status: "approved" as const, expirationDate: null } : e,
    ),
  };
}

/** Complete an overdue/upcoming milestone → done. */
export function completeMilestone(inputs: CommandInputs, id: string): CommandInputs {
  return {
    ...inputs,
    milestones: inputs.milestones.map((m) => (m.id === id ? { ...m, status: "done" as const } : m)),
  };
}

/** Claim an MDF request before its deadline (clears the deadline risk). */
export function clearMdfDeadline(inputs: CommandInputs, id: string): CommandInputs {
  return {
    ...inputs,
    mdf: inputs.mdf.map((m) => (m.id === id ? { ...m, claimDeadline: null } : m)),
  };
}

/** Meet a tier requirement → set current value(s) to the threshold(s). */
export function meetRequirement(inputs: CommandInputs, key: string): CommandInputs {
  return {
    ...inputs,
    tierRequirements: inputs.tierRequirements.map((r) => {
      if (r.key !== key) return r;
      const nextCurrent = r.kind === "boolean" ? Math.max(1, r.threshold) : r.threshold;
      const secThreshold = r.secondaryThreshold ?? null;
      return secThreshold !== null
        ? { ...r, currentValue: nextCurrent, secondaryCurrentValue: secThreshold }
        : { ...r, currentValue: nextCurrent };
    }),
  };
}

/** Re-sync / reconcile Partner Central → fresh + no drift (clears both signals). */
export function freshenAwsSync(inputs: CommandInputs, today: string): CommandInputs {
  return {
    ...inputs,
    awsSync: { status: "configured", lastSyncDate: today, driftCount: 0 },
  };
}
