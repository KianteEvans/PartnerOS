import { healthFromSnapshot, type ReportSnapshot } from "@/domain/reports/metrics";
import type { FlowGraph } from "@/domain/graph/types";

/**
 * Pure, deterministic executive-narrative outline for a report: the partnership's
 * story synthesized from the FROZEN snapshot plus (optionally) the attribution
 * graph's value-flow topology. This is BOTH the grounding handed to the optional AI
 * polish pass and the honest fallback saved verbatim when no API key is configured —
 * so it must read as prose, not a metrics dump. No clocks, no randomness: `today`
 * is injected and every list is stably ordered.
 */

const BAND_LABELS = { strong: "strong", fair: "fair", at_risk: "at risk" } as const;

/** Most flow chains / flagged nodes quoted per paragraph — an outline, not an inventory. */
const MAX_FLOWS = 3;
const MAX_FLAGGED = 3;

const money = (n: number): string => `$${n.toLocaleString("en-US")}`;
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function posture(s: ReportSnapshot, today: string): string {
  const h = healthFromSnapshot(s);
  if (h.drivers.length === 0) {
    return `As of ${today}, this report has no section activity to narrate yet.`;
  }
  const sorted = [...h.drivers].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const strongest = sorted[0]!;
  const weakest = sorted[sorted.length - 1]!;
  let p = `As of ${today}, partnership health stands at ${h.score}/100 (${BAND_LABELS[h.band]}).`;
  if (sorted.length > 1 && strongest.label !== weakest.label) {
    p += ` ${strongest.label} is the strongest driver at ${strongest.score}, while ${weakest.label} lags at ${weakest.score}.`;
  }
  return p;
}

function valueFlow(graph: FlowGraph): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const chains = [...graph.edges]
    .sort((a, b) => b.weight - a.weight || `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`))
    .slice(0, MAX_FLOWS)
    .flatMap((e) => {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (!from || !to) return [];
      // ASCII arrow on purpose: this text is STORED (reports.narrative) and the
      // Windows dev/test embedded Postgres is WIN1252, which cannot encode U+2192.
      return [`${from.label} -> ${to.label}${e.label ? ` (${e.label})` : ""}`];
    });
  if (chains.length === 0) return "";
  return `Where value is flowing: ${chains.join("; ")}.`;
}

function risks(s: ReportSnapshot, graph: FlowGraph | null): string {
  const counts: string[] = [];
  if (s.mdf.deadlineRisks > 0) {
    counts.push(`${s.mdf.deadlineRisks} MDF deadline ${plural(s.mdf.deadlineRisks, "risk", "risks")}`);
  }
  if (s.ace.atRisk > 0) counts.push(`${s.ace.atRisk} at-risk co-sell ${plural(s.ace.atRisk, "deal", "deals")}`);
  if (s.tasks.overdue > 0) counts.push(`${s.tasks.overdue} overdue ${plural(s.tasks.overdue, "task", "tasks")}`);
  if (s.evidence.missing > 0) {
    counts.push(`${s.evidence.missing} evidence ${plural(s.evidence.missing, "gap", "gaps")}`);
  }
  // Builder emission order is deterministic; keep it rather than re-sorting.
  const flagged = graph
    ? graph.nodes.filter((n) => n.tone === "danger" || n.tone === "warn").slice(0, MAX_FLAGGED)
    : [];

  const parts: string[] = [];
  if (counts.length > 0) parts.push(`Watch items: ${counts.join(", ")}.`);
  if (flagged.length > 0) {
    const names = flagged.map((n) => (n.sublabel ? `${n.label} (${n.sublabel})` : n.label));
    parts.push(`Flagged on the value map: ${names.join("; ")}.`);
  }
  return parts.length > 0 ? parts.join(" ") : "No acute risks stand out in this snapshot.";
}

function trajectory(s: ReportSnapshot): string {
  const parts: string[] = [];
  if (s.tier) {
    parts.push(
      `Tier trajectory: ${s.tier.current} -> ${s.tier.target}, ${s.tier.percent}% of requirements met (${s.tier.met}/${s.tier.total}).`,
    );
  }
  const open: string[] = [];
  if (s.ace.open > 0) {
    open.push(`${s.ace.open} open ${plural(s.ace.open, "opportunity", "opportunities")} worth ${money(s.ace.openValue)}`);
  }
  if (s.mdf.open > 0) open.push(`${s.mdf.open} open MDF ${plural(s.mdf.open, "request", "requests")}`);
  if (s.ace.unrouted > 0) open.push(`${s.ace.unrouted} unrouted ${plural(s.ace.unrouted, "deal", "deals")}`);
  parts.push(open.length > 0 ? `In motion: ${open.join(", ")}.` : "No open co-sell or funding decisions are waiting.");
  return parts.join(" ");
}

/**
 * Compose the outline. `graph` is optional so callers without live inputs (dev-seed,
 * tests) degrade to a snapshot-only story; the flow paragraph simply drops out.
 */
export function narrativeOutline(snapshot: ReportSnapshot, graph: FlowGraph | null, today: string): string {
  const paragraphs = [
    posture(snapshot, today),
    graph ? valueFlow(graph) : "",
    risks(snapshot, graph),
    trajectory(snapshot),
  ];
  return paragraphs.filter((p) => p.length > 0).join("\n\n");
}
