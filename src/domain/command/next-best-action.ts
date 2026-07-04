import { isAtRisk, isHighValue } from "@/domain/ace/opportunities";
import { isExpiringSoon } from "@/domain/evidence/inventory";
import { isMilestoneOverdue } from "@/domain/roadmaps/progress";
import { deadlineRisk } from "@/domain/mdf/analytics";
import { gapFor } from "@/domain/tiers/gap";
import { connectorHealth } from "@/domain/settings/connectors";
import {
  baselineFor,
  projectImpact,
  resolveTask,
  winOpp,
  approveEvidence,
  completeMilestone,
  clearMdfDeadline,
  meetRequirement,
  freshenAwsSync,
  type ImpactDelta,
} from "@/domain/command/impact";
import type { CommandInputs } from "@/domain/command/types";

/**
 * Pure "Next-Best-Action" ranker: build the candidate moves from live workspace
 * state (reusing the SAME predicates deriveDecisions uses, plus the tier-requirement
 * gaps that never surface as risks), project each one's cross-domain impact via the
 * what-if engine, and rank by leverage. This is the prescriptive layer ACE can't
 * replicate — it tells the alliance director the highest-leverage moves and the
 * projected impact of each. No database, no clock, no mutation.
 */

export type Effort = "low" | "medium" | "high";

export interface ActionCandidate {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly link: string;
  readonly category: string;
  readonly effort: Effort;
  /** Immutable what-if transform used only to project impact (never persisted). */
  readonly apply: (i: CommandInputs) => CommandInputs;
}

export interface RankedAction {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly link: string;
  readonly category: string;
  readonly effort: Effort;
  readonly impact: ImpactDelta;
  readonly leverage: number;
  readonly quickWin: boolean;
}

/** Build the actionable candidate moves from live inputs (predicate-reused). */
export function buildCandidates(inputs: CommandInputs, today: string): ActionCandidate[] {
  const out: ActionCandidate[] = [];

  for (const t of inputs.tasks) {
    if (t.status === "done") continue;
    const overdue = t.dueDate !== null && t.dueDate < today;
    if (overdue || t.status === "blocked") {
      out.push({
        key: `task-${t.id}`,
        title: overdue ? `Clear overdue task: ${t.title}` : `Unblock: ${t.title}`,
        detail: overdue ? `Due ${t.dueDate}.` : "Blocked and needs intervention.",
        link: "/command/tasks",
        category: "task",
        effort: "low",
        apply: (i) => resolveTask(i, t.id),
      });
    }
  }

  for (const o of inputs.opportunities) {
    if (isAtRisk(o, today) && isHighValue(o)) {
      out.push({
        key: `opp-${o.id}`,
        title: `Advance at-risk deal: ${o.name}`,
        detail: `$${o.amount.toLocaleString()} — stale or past its close date.`,
        link: `/ace?tab=opportunities#opp-${o.id}`,
        category: "opportunity",
        effort: "high",
        apply: (i) => winOpp(i, o.id),
      });
    }
  }

  for (const e of inputs.evidence) {
    if (isExpiringSoon(e, today)) {
      out.push({
        key: `evidence-${e.id}`,
        title: `Renew expiring evidence: ${e.title}`,
        detail: `Expires ${e.expirationDate}.`,
        link: "/programs/evidence",
        category: "evidence",
        effort: "low",
        apply: (i) => approveEvidence(i, e.id),
      });
    }
  }

  for (const m of inputs.milestones) {
    if (isMilestoneOverdue(m, today)) {
      out.push({
        key: `milestone-${m.id}`,
        title: `Complete overdue milestone: ${m.title}`,
        detail: `Target ${m.targetDate} has passed.`,
        link: `/plan/roadmaps/${m.roadmapId}#ms-${m.id}`,
        category: "milestone",
        effort: "medium",
        apply: (i) => completeMilestone(i, m.id),
      });
    }
  }

  for (const m of inputs.mdf) {
    if (deadlineRisk(m, today)) {
      const overdue = m.claimDeadline !== null && m.claimDeadline < today;
      out.push({
        key: `mdf-${m.id}`,
        title: `Claim MDF before deadline: ${m.title}`,
        detail: overdue ? "Claim deadline has passed." : `Claim by ${m.claimDeadline}.`,
        link: `/mdf/${m.id}`,
        category: "mdf",
        effort: "medium",
        apply: (i) => clearMdfDeadline(i, m.id),
      });
    }
  }

  // Unmet gating tier requirements — the highest-leverage "path to tier" moves,
  // which never appear in the reactive risk queue today.
  if (inputs.tier) {
    const target = inputs.tier.targetTier;
    for (const r of inputs.tierRequirements) {
      if (r.informational || gapFor(r).met) continue;
      out.push({
        key: `tier-${r.key}`,
        title: `Meet tier requirement: ${r.label}`,
        detail: `${r.currentValue}/${r.threshold} toward ${target}.`,
        link: "/programs/tiers",
        category: "tier",
        effort: "low",
        apply: (i) => meetRequirement(i, r.key),
      });
    }
  }

  if (inputs.awsSync) {
    const drift = inputs.awsSync.driftCount;
    const stale =
      inputs.awsSync.status === "configured" &&
      connectorHealth({ status: "configured", lastSyncDate: inputs.awsSync.lastSyncDate }, today) === "stale";
    if (drift > 0 || stale) {
      out.push({
        key: "aws-sync",
        title: drift > 0 ? "Reconcile Partner Central drift" : "Re-sync Partner Central",
        detail:
          drift > 0
            ? `${drift} opportunit${drift === 1 ? "y differs" : "ies differ"} from AWS.`
            : "Co-sell data is stale — re-sync from AWS.",
        link: "/ace?tab=reconcile",
        category: "aws_sync",
        effort: "low",
        apply: (i) => freshenAwsSync(i, today),
      });
    }
  }

  return out;
}

const EFFORT_LABELS: Record<Effort, string> = { low: "Quick", medium: "Moderate", high: "Involved" };
export { EFFORT_LABELS };

/**
 * Rank candidates by projected leverage (a tunable blend of health, tier %, and
 * alert-queue impact), keep only positive-leverage moves, tag quick wins, take topN.
 */
export function nextBestActions(inputs: CommandInputs, today: string, topN = 3): RankedAction[] {
  const baseline = baselineFor(inputs, today);
  const ranked: RankedAction[] = [];
  for (const c of buildCandidates(inputs, today)) {
    const impact = projectImpact(baseline, c.apply(inputs), today);
    // Weights are tunable: alert reduction and tier progress read strongest to an
    // alliance director; health is the composite backstop.
    const leverage = impact.healthDelta + 0.6 * impact.tierPctDelta + 3 * impact.queueDelta;
    if (leverage <= 0) continue;
    ranked.push({
      key: c.key,
      title: c.title,
      detail: c.detail,
      link: c.link,
      category: c.category,
      effort: c.effort,
      impact,
      leverage: Math.round(leverage * 10) / 10,
      quickWin: false,
    });
  }
  ranked.sort((a, b) => b.leverage - a.leverage);
  const top = ranked.slice(0, topN);
  const best = top[0]?.leverage ?? 0;
  // A quick win is a low-effort move that still carries meaningful leverage.
  return top.map((a) => ({ ...a, quickWin: a.effort === "low" && a.leverage >= best * 0.5 }));
}
