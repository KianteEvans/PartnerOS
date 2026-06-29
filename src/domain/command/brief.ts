import { addDays } from "@/domain/dates";
import { deadlineRisk } from "@/domain/mdf/analytics";
import { isAtRisk, isHighValue } from "@/domain/ace/opportunities";
import { computeRepHealth } from "@/domain/ace/rep-intelligence";
import { isExpiringSoon } from "@/domain/evidence/inventory";
import { isMilestoneOverdue, isMilestoneUpcoming } from "@/domain/roadmaps/progress";
import { renewalReadiness, RENEWAL_BAND_LABELS } from "@/domain/solutions/renewal";
import type { TierId } from "@/domain/tiers/catalog";
import type { CommandInputs } from "@/domain/command/types";

/**
 * Pure "Today's Command Brief": derive the prioritized decision queue and the
 * work summary from the aggregated inputs. No database, no clock — the caller
 * passes `today`. Deterministic and unit-testable.
 */

export type Severity = "critical" | "high" | "medium";

export type Situation =
  | "overdue_work"
  | "blocked_work"
  | "mdf_deadline"
  | "aws_review"
  | "roadmap_risk"
  | "renewal_due"
  | "evidence";

export const SITUATION_LABELS: Record<Situation, string> = {
  overdue_work: "Overdue work",
  blocked_work: "Blocked work",
  mdf_deadline: "MDF deadline",
  aws_review: "AWS / co-sell review",
  roadmap_risk: "Roadmap risk",
  renewal_due: "Specialization renewal",
  evidence: "Evidence",
};

export interface Decision {
  readonly id: string;
  readonly severity: Severity;
  readonly situation: Situation;
  readonly title: string;
  readonly detail: string;
  readonly ownerUserId: string | null;
  readonly dueDate: string | null;
  readonly link: string;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };

const PROGRAM_RENEWAL_WINDOW_DAYS = 90;

/** Derive every actionable decision/risk across sections, most urgent first. */
export function deriveDecisions(inputs: CommandInputs, today: string): Decision[] {
  const out: Decision[] = [];

  for (const t of inputs.tasks) {
    if (t.status === "done") continue;
    if (t.dueDate !== null && t.dueDate < today) {
      out.push({
        id: `task-overdue-${t.id}`,
        severity: t.priority === "critical" ? "critical" : "high",
        situation: "overdue_work",
        title: `Overdue: ${t.title}`,
        detail: `Task due ${t.dueDate}.`,
        ownerUserId: t.ownerUserId,
        dueDate: t.dueDate,
        link: "/command/tasks",
      });
    } else if (t.status === "blocked") {
      out.push({
        id: `task-blocked-${t.id}`,
        severity: t.priority === "critical" ? "critical" : "high",
        situation: "blocked_work",
        title: `Blocked: ${t.title}`,
        detail: "Task is blocked and needs intervention.",
        ownerUserId: t.ownerUserId,
        dueDate: t.dueDate,
        link: "/command/tasks",
      });
    }
  }

  for (const m of inputs.mdf) {
    if (deadlineRisk(m, today)) {
      const overdue = m.claimDeadline !== null && m.claimDeadline < today;
      out.push({
        id: `mdf-${m.id}`,
        severity: overdue ? "critical" : "high",
        situation: "mdf_deadline",
        title: `MDF claim deadline: ${m.title}`,
        detail: overdue ? "Claim deadline has passed." : `Claim by ${m.claimDeadline}.`,
        ownerUserId: m.ownerUserId,
        dueDate: m.claimDeadline,
        link: `/mdf/${m.id}`,
      });
    }
  }

  for (const o of inputs.opportunities) {
    if (isAtRisk(o, today) && isHighValue(o)) {
      out.push({
        id: `opp-${o.id}`,
        severity: "high",
        situation: "aws_review",
        title: `At-risk opportunity: ${o.name}`,
        detail: "High-value opportunity is stale or past its close date.",
        ownerUserId: o.ownerUserId,
        dueDate: o.closeDate,
        link: "/ace",
      });
    }
  }

  // Cooling AWS-rep relationships with co-sell pipeline riding on them.
  for (const h of computeRepHealth(inputs.relationships, inputs.opportunities, today)) {
    if (!h.atStake) continue;
    out.push({
      id: `rep-${h.id}`,
      severity: "high",
      situation: "aws_review",
      title: `Cooling AWS relationship: ${h.name}`,
      detail: `$${h.openValue.toLocaleString()} of pipeline at stake; last contact ${
        h.daysSinceContact === null ? "never" : `${h.daysSinceContact}d ago`
      }.`,
      ownerUserId: null,
      dueDate: null,
      link: "/ace?tab=relationships",
    });
  }

  for (const p of inputs.programs) {
    const expired = p.status === "expired";
    const renewing =
      p.status === "active" &&
      p.expirationDate !== null &&
      p.expirationDate <= addDays(today, PROGRAM_RENEWAL_WINDOW_DAYS);
    if (expired || renewing) {
      out.push({
        id: `program-${p.id}`,
        severity: expired ? "high" : "medium",
        situation: "roadmap_risk",
        title: `Program renewal: ${p.name}`,
        detail: expired ? "Program has expired." : `Renews by ${p.expirationDate}.`,
        ownerUserId: null,
        dueDate: p.expirationDate,
        link: `/programs/${p.id}`,
      });
    }
  }

  // Milestones on finalized roadmaps (committed plans): flag overdue ones, and warn
  // on the ones coming due within the look-ahead window before they slip.
  for (const m of inputs.milestones) {
    if (isMilestoneOverdue(m, today)) {
      out.push({
        id: `milestone-${m.id}`,
        severity: "high",
        situation: "roadmap_risk",
        title: `Overdue milestone: ${m.title}`,
        detail: `Target ${m.targetDate} has passed.`,
        ownerUserId: m.ownerUserId,
        dueDate: m.targetDate,
        link: `/plan/roadmaps/${m.roadmapId}`,
      });
    } else if (isMilestoneUpcoming(m, today)) {
      out.push({
        id: `milestone-upcoming-${m.id}`,
        severity: "medium",
        situation: "roadmap_risk",
        title: `Milestone due soon: ${m.title}`,
        detail: `Target ${m.targetDate}.`,
        ownerUserId: m.ownerUserId,
        dueDate: m.targetDate,
        link: `/plan/roadmaps/${m.roadmapId}`,
      });
    }
  }

  // Specialization Solutions whose renewal is slipping (the 2026 launched-opp rule).
  for (const s of inputs.solutions) {
    const status = renewalReadiness(
      {
        availability: s.availability,
        programType: s.programType,
        solutionType: s.solutionType,
        ftrStatus: s.ftrStatus,
        currentTier: inputs.currentTier as TierId,
        launchedCount: s.launchedCount,
        renewalDate: s.renewalDate,
      },
      today,
    );
    if (status.band === "compliant") continue;
    const gaps = status.criteria.filter((c) => !c.ok).map((c) => c.label);
    out.push({
      id: `solution-renewal-${s.id}`,
      severity: status.band === "non_compliant" ? "critical" : "high",
      situation: "renewal_due",
      title: `Specialization renewal at risk: ${s.title}`,
      detail:
        gaps.length > 0
          ? `${RENEWAL_BAND_LABELS[status.band]} — ${gaps.join(", ")}.`
          : `${RENEWAL_BAND_LABELS[status.band]} — renewal due ${s.renewalDate ?? "soon"}.`,
      ownerUserId: null,
      dueDate: s.renewalDate,
      link: `/programs/solutions/${s.id}`,
    });
  }

  for (const e of inputs.evidence) {
    if (isExpiringSoon(e, today)) {
      out.push({
        id: `evidence-${e.id}`,
        severity: "medium",
        situation: "evidence",
        title: `Evidence expiring: ${e.title}`,
        detail: `Expires ${e.expirationDate}.`,
        ownerUserId: e.ownerUserId,
        dueDate: e.expirationDate,
        link: "/programs/evidence",
      });
    }
  }

  return out.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

export interface WorkSummary {
  readonly open: number;
  readonly overdue: number;
  readonly blocked: number;
  readonly critical: number;
}

export function workSummary(
  tasks: CommandInputs["tasks"],
  today: string,
): WorkSummary {
  const openTasks = tasks.filter((t) => t.status !== "done");
  return {
    open: openTasks.length,
    overdue: openTasks.filter((t) => t.dueDate !== null && t.dueDate < today).length,
    blocked: openTasks.filter((t) => t.status === "blocked").length,
    critical: openTasks.filter((t) => t.priority === "critical").length,
  };
}

export type DecisionView = "all" | "critical" | Situation;

export const DECISION_VIEWS: readonly DecisionView[] = [
  "all",
  "critical",
  "overdue_work",
  "blocked_work",
  "mdf_deadline",
  "aws_review",
  "roadmap_risk",
  "renewal_due",
  "evidence",
];

export const DECISION_VIEW_LABELS: Record<DecisionView, string> = {
  all: "All",
  critical: "Critical",
  ...SITUATION_LABELS,
};

export function filterDecisions(
  decisions: readonly Decision[],
  view: DecisionView,
): Decision[] {
  if (view === "all") return [...decisions];
  if (view === "critical") return decisions.filter((d) => d.severity === "critical");
  return decisions.filter((d) => d.situation === view);
}
