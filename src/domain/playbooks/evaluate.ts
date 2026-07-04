import type { AutomationMode, CapabilityDecision } from "@/domain/settings/automation";
import { capabilityDecision } from "@/domain/settings/automation";
import type { Decision, Severity } from "@/domain/command/brief";
import { capabilityForAction, type NotifyChannel, type PlaybookActionType } from "./catalog";

/**
 * The pure heart of the playbook engine: given the tenant's playbooks, the live
 * decision queue (deriveDecisions), and the automation mode, decide which runs to
 * materialize and how each should behave (auto / approval / recommend). No DB, no
 * clock — the materialize op persists the result; the runner executes it.
 */

export interface PlaybookLike {
  readonly id: string;
  readonly enabled: boolean;
  readonly triggerSituation: string;
  readonly triggerMinSeverity: string;
  readonly actionType: string;
  readonly actionParams: Record<string, unknown>;
  readonly channels: readonly string[];
}

export interface PlannedRun {
  readonly playbookId: string;
  readonly decisionId: string;
  readonly decision: Decision;
  readonly actionType: PlaybookActionType;
  readonly actionParams: Record<string, unknown>;
  readonly channels: NotifyChannel[];
  readonly verdict: CapabilityDecision;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1 };

/**
 * Cross-join enabled playbooks with matching decisions. A playbook's verdict is a
 * function of (mode, action risk) only, so it's computed once per playbook; a
 * `blocked` verdict (mode off) yields no runs. Each matching decision becomes one
 * PlannedRun (deduped downstream by the fire-once unique index).
 */
export function evaluatePlaybooks(
  playbooks: readonly PlaybookLike[],
  decisions: readonly Decision[],
  mode: AutomationMode,
): PlannedRun[] {
  const out: PlannedRun[] = [];
  for (const p of playbooks) {
    if (!p.enabled) continue;
    const actionType = p.actionType as PlaybookActionType;
    const channels = p.channels.filter((c): c is NotifyChannel =>
      c === "in_app" || c === "email" || c === "webhook",
    );
    const verdict = capabilityDecision(mode, capabilityForAction(actionType, channels));
    if (verdict === "blocked") continue;
    const minRank = SEVERITY_RANK[p.triggerMinSeverity as Severity] ?? 1;
    for (const d of decisions) {
      if (d.situation !== p.triggerSituation) continue;
      if (SEVERITY_RANK[d.severity] < minRank) continue;
      out.push({
        playbookId: p.id,
        decisionId: d.id,
        decision: d,
        actionType,
        actionParams: p.actionParams,
        channels,
        verdict,
      });
    }
  }
  return out;
}
