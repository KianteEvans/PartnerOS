import { healthScore, WEIGHTS } from "@/domain/command/health";
import { deriveDecisions } from "@/domain/command/brief";
import { buildCandidates } from "@/domain/command/next-best-action";
import { baselineFor, projectImpact } from "@/domain/command/impact";
import { gapFor } from "@/domain/tiers/gap";
import type { CommandInputs } from "@/domain/command/types";
import type { CausalGraph, GraphEdge, GraphNode, NodeImpact } from "@/domain/graph/types";
import {
  DRIVER_LINK,
  DRIVER_WEIGHT_KEY,
  SITUATION_TO_DRIVER,
  bandTone,
  driverTone,
  severityTone,
  decisionToActionKey,
  type DriverLabel,
} from "@/domain/graph/shared";

/**
 * Pure causal decomposition of the partnership health score: root (Health) ← 6 weighted
 * drivers ← the specific open risks dragging each driver. Every fixable cause carries its
 * projected impact — the SAME numbers as the Command Center "Your move" panel, because the
 * impact is computed from the identical impact.ts candidate transforms. No DB, no clock.
 *
 * This is the view ACE structurally cannot offer: it has no composite health, no weighting,
 * and no cross-domain "why is my number what it is" decomposition.
 */

const CAUSE_CAP = 4;
const DRIVER_ORDER: readonly DriverLabel[] = ["Evidence", "MDF", "ACE", "Programs", "Tasks", "Tier"];
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2 };

interface Cause {
  readonly node: GraphNode;
  readonly severityRank: number;
  readonly healthDelta: number;
  readonly queueDelta: number;
}

/** Cause→driver edge weight scales with the projected health gain (min floor so it's visible). */
function causeWeight(impact: NodeImpact | undefined): number {
  const gain = impact ? impact.healthDelta : 0;
  return Math.max(0.2, Math.min(1, 0.2 + gain / 15));
}

export function buildCausalGraph(inputs: CommandInputs, today: string): CausalGraph {
  const health = healthScore(inputs, today);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Root — Partnership Health.
  const root: GraphNode = {
    id: "health",
    kind: "health",
    label: "Partnership health",
    sublabel: health.band.replace("_", " "),
    score: health.score,
    tone: bandTone(health.band),
    link: "/command",
    column: "root",
  };

  // Drivers — one per health component; edge weighted by its WEIGHT.
  const driverNodes: GraphNode[] = [];
  const driverScore = new Map(health.drivers.map((d) => [d.label, d.score]));
  for (const label of DRIVER_ORDER) {
    const score = driverScore.get(label) ?? 0;
    const tone = driverTone(score);
    driverNodes.push({
      id: `driver-${label}`,
      kind: "driver",
      label,
      sublabel: `${score}/100`,
      score,
      tone,
      link: DRIVER_LINK[label],
      column: "driver",
    });
    const weight = WEIGHTS[DRIVER_WEIGHT_KEY[label]];
    edges.push({ from: `driver-${label}`, to: "health", weight, label: `${Math.round(weight * 100)}%`, tone });
  }

  // Causes — the open risks dragging each driver, impact matched to the ranker.
  const baseline = baselineFor(inputs, today);
  const impactByKey = new Map<string, NodeImpact>(
    buildCandidates(inputs, today).map((c) => [c.key, projectImpact(baseline, c.apply(inputs), today)]),
  );

  const causesByDriver = new Map<DriverLabel, Cause[]>(DRIVER_ORDER.map((d) => [d, []]));

  for (const d of deriveDecisions(inputs, today)) {
    const driver = SITUATION_TO_DRIVER[d.situation];
    if (driver === null) continue; // marketplace / aws-sync are not health drivers
    const key = decisionToActionKey(d);
    const impact = key ? impactByKey.get(key) : undefined;
    causesByDriver.get(driver)?.push({
      node: {
        id: `cause-${d.id}`,
        kind: "cause",
        label: d.title,
        sublabel: d.detail,
        tone: severityTone(d.severity),
        ...(impact ? { impact } : {}),
        link: d.link,
        column: "cause",
      },
      severityRank: SEVERITY_RANK[d.severity] ?? 3,
      healthDelta: impact?.healthDelta ?? 0,
      queueDelta: impact?.queueDelta ?? 0,
    });
  }

  // Unmet gating tier requirements (never surface as decisions) — same filter buildCandidates uses.
  if (inputs.tier) {
    for (const r of inputs.tierRequirements) {
      if (r.informational || gapFor(r).met) continue;
      const impact = impactByKey.get(`tier-${r.key}`);
      causesByDriver.get("Tier")?.push({
        node: {
          id: `cause-tier-${r.key}`,
          kind: "cause",
          label: `Meet requirement: ${r.label}`,
          sublabel: `${r.currentValue}/${r.threshold} toward ${inputs.tier.targetTier}`,
          tone: "warn",
          ...(impact ? { impact } : {}),
          link: "/programs/tiers",
          column: "cause",
        },
        severityRank: 1,
        healthDelta: impact?.healthDelta ?? 0,
        queueDelta: impact?.queueDelta ?? 0,
      });
    }
  }

  // Cap per driver (critical first, then by projected health gain) + a "+N more" node.
  for (const label of DRIVER_ORDER) {
    const list = (causesByDriver.get(label) ?? [])
      .slice()
      .sort((a, b) => a.severityRank - b.severityRank || b.healthDelta - a.healthDelta || b.queueDelta - a.queueDelta);
    const shown = list.slice(0, CAUSE_CAP);
    for (const c of shown) {
      nodes.push(c.node);
      edges.push({ from: c.node.id, to: `driver-${label}`, weight: causeWeight(c.node.impact), tone: c.node.tone });
    }
    const extra = list.length - shown.length;
    if (extra > 0) {
      const moreId = `cause-more-${label}`;
      nodes.push({
        id: moreId,
        kind: "cause",
        label: `+${extra} more`,
        sublabel: `in ${label}`,
        tone: "neutral",
        link: DRIVER_LINK[label],
        column: "cause",
      });
      edges.push({ from: moreId, to: `driver-${label}`, weight: 0.2, tone: "neutral" });
    }
  }

  nodes.push(...driverNodes, root);
  return { kind: "causal", nodes, edges, health: { score: health.score, band: health.band } };
}
