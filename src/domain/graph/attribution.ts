import { pipelineSummary } from "@/domain/ace/opportunities";
import { repWinRows } from "@/domain/ace/winloss";
import { portfolioSummary } from "@/domain/mdf/analytics";
import { completeness } from "@/domain/evidence/inventory";
import { renewalReadiness } from "@/domain/solutions/renewal";
import { planSummary } from "@/domain/tiers/gap";
import { roiRollup } from "@/domain/programs/roi";
import type { ProgramRoiListItem } from "@/domain/programs/roi-load";
import type { TierId } from "@/domain/tiers/catalog";
import type { CommandInputs } from "@/domain/command/types";
import type { FlowGraph, GraphEdge, GraphNode, GraphTone } from "@/domain/graph/types";
import { money } from "@/domain/format";

/**
 * Pure "attribution flow": how AWS-partnership work in one domain flows into outcomes in
 * another — MDF funds → ACE pipeline; ACE opportunities → competencies → attributed
 * revenue; launched opps + evidence + specializations → tier advancement; marketplace
 * listings → solutions. Every edge is a real, counted cross-domain relationship (from the
 * existing FKs + engines), not a guess. This is the connective tissue ACE's siloed,
 * per-object lists structurally cannot assemble. No DB, no clock beyond `today`.
 */

export interface AttributionListing {
  readonly id: string;
  readonly title: string;
  readonly solutionId: string | null;
  readonly published: boolean;
}

export interface AttributionExtra {
  /** Per-competency ROI rollup (from the existing loadProgramRoi loader). */
  readonly competencies: readonly ProgramRoiListItem[];
  /** Marketplace listings with their (locally-managed) solution link. */
  readonly listings: readonly AttributionListing[];
  /** Approved AWS funding (Wave 2 ROI loop) — the second spend source feeding ACE. */
  readonly funding?: { readonly approved: number };
}

const COMPETENCY_CAP = 6;
const shareWeight = (v: number, max: number): number =>
  Math.max(0.3, Math.min(1, 0.3 + (max > 0 ? v / max : 0) * 0.7));

const RENEWAL_BAND_TONE: Record<string, GraphTone> = {
  compliant: "ok",
  at_risk: "warn",
  non_compliant: "danger",
};

export function buildAttributionGraph(
  inputs: CommandInputs,
  extra: AttributionExtra,
  today: string,
): FlowGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const has = (id: string) => nodes.some((n) => n.id === id);

  // Engine hub — ACE co-sell (always present; it's the center of the flow).
  const pipe = pipelineSummary(inputs.opportunities, today);
  nodes.push({
    id: "ace",
    kind: "ace",
    label: "ACE co-sell",
    sublabel: `${pipe.open} open · ${money(pipe.openValue)}`,
    tone: "info",
    link: "/ace",
    column: "flow",
  });

  // Tier sink.
  if (inputs.tier) {
    const tier = planSummary(inputs.tierRequirements);
    nodes.push({
      id: "tier",
      kind: "tier",
      label: `Tier: ${inputs.tier.targetTier}`,
      sublabel: `${tier.percent}% ready · ${tier.met}/${tier.total} reqs`,
      tone: tier.percent >= 70 ? "ok" : tier.percent >= 45 ? "warn" : "danger",
      link: "/programs/tiers",
      column: "sink",
    });
    const launched = inputs.opportunities.filter((o) => o.stage === "launched").length;
    if (launched > 0) {
      edges.push({ from: "ace", to: "tier", weight: 0.5, label: `${launched} launched`, tone: "info" });
    }
  }

  // MDF investment → ACE pipeline.
  if (inputs.mdf.length > 0) {
    const mdf = portfolioSummary(inputs.mdf, today);
    nodes.push({
      id: "mdf",
      kind: "mdf",
      label: "MDF",
      sublabel: `${money(mdf.approved)} approved`,
      tone: "warn",
      link: "/mdf",
      column: "source",
    });
    if (mdf.pipeline > 0) {
      edges.push({ from: "mdf", to: "ace", weight: 0.5, label: money(mdf.pipeline), tone: "warn" });
    }
  }

  // Funding investment → ACE pipeline (Wave 2 ROI loop: the second spend source that
  // feeds co-sell, alongside MDF). Reuses the "mdf" node kind — both are warn spend.
  if (extra.funding && extra.funding.approved > 0) {
    nodes.push({
      id: "funding",
      kind: "mdf",
      label: "AWS Funding",
      sublabel: `${money(extra.funding.approved)} approved`,
      tone: "warn",
      link: "/funding",
      column: "source",
    });
    edges.push({ from: "funding", to: "ace", weight: 0.5, label: money(extra.funding.approved), tone: "warn" });
  }

  // AWS relationships → ACE (Wave 2 win/loss mining: WHO drives the wins). Top three
  // relationships by won TCV with at least one closed deal, toned by their win rate.
  const repRows = repWinRows(inputs.relationships, inputs.opportunities).slice(0, 3);
  for (const rep of repRows) {
    const id = `rep-${rep.id}`;
    nodes.push({
      id,
      kind: "rep",
      label: rep.name,
      sublabel: `${rep.winRate == null ? "—" : `${rep.winRate}%`} wins · ${money(rep.wonTCV)}`,
      tone: rep.winRate != null && rep.winRate >= 60 ? "ok" : rep.winRate != null && rep.winRate >= 40 ? "info" : "warn",
      link: "/ace?tab=relationships",
      column: "source",
    });
    edges.push({
      from: id,
      to: "ace",
      weight: shareWeight(rep.wonTCV, repRows[0]?.wonTCV ?? 0),
      label: `${rep.won} won`,
      tone: "info",
    });
  }

  // Evidence → Tier (evidence backs the gating requirements).
  if (inputs.evidence.length > 0 && inputs.tier) {
    const ev = completeness(inputs.evidence);
    nodes.push({
      id: "evidence",
      kind: "evidence",
      label: "Evidence",
      sublabel: `${ev.approved}/${ev.total} approved`,
      tone: "accent",
      link: "/programs/evidence",
      column: "source",
    });
    if (ev.approved > 0) {
      edges.push({ from: "evidence", to: "tier", weight: 0.4, label: `${ev.approved} approved`, tone: "accent" });
    }
  }

  // Competencies: ACE opps → competency → attributed revenue.
  const earning = extra.competencies
    .filter((c) => c.roi.attributedCount > 0)
    .slice()
    .sort((a, b) => b.roi.wonTCV - a.roi.wonTCV);
  const shownComps = earning.slice(0, COMPETENCY_CAP);
  const maxWon = Math.max(1, ...shownComps.map((c) => c.roi.wonTCV));
  const maxAttr = Math.max(1, ...shownComps.map((c) => c.roi.attributedCount));

  if (shownComps.length > 0) {
    const rollup = roiRollup(shownComps.map((c) => ({ name: c.name, roi: c.roi })));
    nodes.push({
      id: "roi",
      kind: "roi",
      label: "Attributed revenue",
      sublabel: `${money(rollup.wonTCV)} won`,
      tone: "ok",
      link: "/programs?view=roi",
      column: "sink",
    });
    for (const c of shownComps) {
      const cid = `comp-${c.id}`;
      nodes.push({
        id: cid,
        kind: "competency",
        label: c.name,
        sublabel: `${c.roi.attributedCount} opps · ${money(c.roi.wonTCV)} won`,
        tone: "accent",
        link: `/programs/${c.id}`,
        column: "flow",
      });
      edges.push({ from: "ace", to: cid, weight: shareWeight(c.roi.attributedCount, maxAttr), label: `${c.roi.attributedCount} opps`, tone: "info" });
      edges.push({ from: cid, to: "roi", weight: shareWeight(c.roi.wonTCV, maxWon), label: money(c.roi.wonTCV), tone: "ok" });
    }
    const moreComp = earning.length - shownComps.length;
    if (moreComp > 0) {
      nodes.push({ id: "comp-more", kind: "competency", label: `+${moreComp} more`, sublabel: "competencies", tone: "neutral", link: "/programs?view=roi", column: "flow" });
      edges.push({ from: "ace", to: "comp-more", weight: 0.3, tone: "neutral" });
    }
  }

  // Solutions (specializations) → Tier, toned by renewal readiness; Marketplace → Solutions.
  if (inputs.solutions.length > 0) {
    const statuses = inputs.solutions.map((s) =>
      renewalReadiness(
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
      ),
    );
    const atRisk = statuses.filter((r) => r.band !== "compliant").length;
    const worst = statuses.some((r) => r.band === "non_compliant")
      ? "non_compliant"
      : atRisk > 0
        ? "at_risk"
        : "compliant";
    nodes.push({
      id: "solutions",
      kind: "solution",
      label: "Specializations",
      sublabel: atRisk > 0 ? `${inputs.solutions.length} · ${atRisk} at risk` : `${inputs.solutions.length} compliant`,
      tone: RENEWAL_BAND_TONE[worst] ?? "neutral",
      link: "/programs?view=solutions",
      column: "sink",
    });
    if (has("tier")) {
      edges.push({ from: "solutions", to: "tier", weight: 0.4, label: "maintains", tone: RENEWAL_BAND_TONE[worst] ?? "neutral" });
    }

    const linked = extra.listings.filter((l) => l.solutionId !== null).length;
    if (extra.listings.length > 0) {
      nodes.push({
        id: "marketplace",
        kind: "marketplace",
        label: "Marketplace",
        sublabel: `${extra.listings.filter((l) => l.published).length}/${extra.listings.length} published`,
        tone: "accent",
        link: "/marketplace",
        column: "source",
      });
      if (linked > 0) {
        edges.push({ from: "marketplace", to: "solutions", weight: 0.4, label: `${linked} linked`, tone: "accent" });
      }
    }
  }

  return { kind: "flow", nodes, edges };
}
