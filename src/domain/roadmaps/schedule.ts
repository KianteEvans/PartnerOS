import { daysBetween } from "@/domain/dates";

/**
 * Pure schedule analysis for a roadmap's milestone dependency graph. No database,
 * no clock. Each milestone has a single optional predecessor (dependsOnId); the
 * graph is therefore a forest of chains. Date-only — there are no durations, so
 * "slack" and "critical path" are derived from target dates alone:
 *  - a conflict is a milestone scheduled on/before the milestone it depends on,
 *  - the critical path is the dependency chain ending at the latest-dated milestone
 *    (the one that determines the finish),
 *  - per-milestone slack is the gap to its tightest (earliest) successor.
 *
 * `wouldCreateCycle` lives here too so the operation that edits a dependency and
 * the views that render it share one tested guard.
 *
 * (Single-predecessor is deliberate for partner roadmaps of ~5-15 milestones. A
 * future multi-predecessor model would add a junction edge list; analyzeSchedule
 * already returns id-lists, so it generalizes.)
 */

export interface ScheduleMilestone {
  readonly id: string;
  readonly sequence: number;
  readonly targetDate: string;
  readonly dependsOnId: string | null;
}

export interface ScheduleConflict {
  readonly id: string;
  readonly dependsOnId: string;
  readonly predecessorSequence: number;
}

export interface ScheduleAnalysis {
  readonly conflicts: readonly ScheduleConflict[];
  /** Ordered ids, root -> finish. Empty when there are no milestones. */
  readonly criticalPath: readonly string[];
  /** Per-milestone days to its tightest successor; null when it has none. */
  readonly slackByEdge: Readonly<Record<string, number | null>>;
}

export interface DepNode {
  readonly id: string;
  readonly sequence: number;
  readonly dependsOnId: string | null;
}

/**
 * Would pointing `fromId` at `toId` create a cycle? True for a self-reference,
 * or when `toId` already depends (transitively) on `fromId`. Bounded by the node
 * count and guarded against a pre-existing cycle.
 */
export function wouldCreateCycle(
  nodes: readonly DepNode[],
  fromId: string,
  toId: string,
): boolean {
  if (fromId === toId) return true;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  let cursor: string | null = toId;
  while (cursor !== null) {
    if (cursor === fromId) return true;
    if (seen.has(cursor)) break; // pre-existing cycle; stop walking
    seen.add(cursor);
    cursor = byId.get(cursor)?.dependsOnId ?? null;
  }
  return false;
}

export function analyzeSchedule(
  milestones: readonly ScheduleMilestone[],
): ScheduleAnalysis {
  const byId = new Map(milestones.map((m) => [m.id, m]));

  // (a) conflicts — a milestone on/before the one it depends on.
  const conflicts: ScheduleConflict[] = [];
  for (const m of milestones) {
    if (!m.dependsOnId) continue;
    const pred = byId.get(m.dependsOnId);
    if (!pred) continue; // dangling edge
    if (m.targetDate <= pred.targetDate) {
      conflicts.push({ id: m.id, dependsOnId: pred.id, predecessorSequence: pred.sequence });
    }
  }

  // (b) critical path — chain ending at the latest-dated milestone.
  let criticalPath: string[] = [];
  if (milestones.length > 0) {
    let finish = milestones[0]!;
    for (const m of milestones) {
      if (
        m.targetDate > finish.targetDate ||
        (m.targetDate === finish.targetDate && m.sequence > finish.sequence) ||
        (m.targetDate === finish.targetDate && m.sequence === finish.sequence && m.id > finish.id)
      ) {
        finish = m;
      }
    }
    const chain: string[] = [];
    const seen = new Set<string>();
    let cursor: ScheduleMilestone | undefined = finish;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      chain.push(cursor.id);
      cursor = cursor.dependsOnId ? byId.get(cursor.dependsOnId) : undefined;
    }
    criticalPath = chain.reverse();
  }

  // (c) slack — days from each milestone to its tightest (earliest) successor.
  const tightestSucc = new Map<string, string>();
  for (const m of milestones) {
    if (!m.dependsOnId || !byId.has(m.dependsOnId)) continue;
    const cur = tightestSucc.get(m.dependsOnId);
    if (cur === undefined || m.targetDate < cur) tightestSucc.set(m.dependsOnId, m.targetDate);
  }
  const slackByEdge: Record<string, number | null> = {};
  for (const m of milestones) {
    const succDate = tightestSucc.get(m.id);
    slackByEdge[m.id] = succDate === undefined ? null : daysBetween(m.targetDate, succDate);
  }

  return { conflicts, criticalPath, slackByEdge };
}
