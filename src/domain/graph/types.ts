/**
 * Pure, JSON-serializable data model for the Partnership Graph. The builders emit
 * these plain objects (no functions, no class instances) so a server component can
 * pass a graph straight to the interactive client island. `layoutGraph` fills in
 * x/y; the builders leave them undefined (topology only).
 */

/** Semantic tone — the SAME names as the Badge primitive; the renderer maps to CSS vars. */
export type GraphTone = "ok" | "warn" | "danger" | "info" | "neutral" | "accent";

/** Which column a node sits in. Causal: cause → driver → root. Flow: source → flow → sink. */
export type GraphColumn = "cause" | "driver" | "root" | "source" | "flow" | "sink";

export type NodeKind =
  | "health"
  | "driver"
  | "cause"
  | "ace"
  | "competency"
  | "tier"
  | "evidence"
  | "mdf"
  | "solution"
  | "marketplace"
  | "roi"
  | "rep";

/** The projected effect of acting on a node — reused verbatim from impact.ts. */
export interface NodeImpact {
  readonly healthDelta: number;
  readonly tierPctDelta: number;
  readonly queueDelta: number;
}

export interface GraphNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly label: string;
  readonly sublabel?: string;
  /** 0–100 for health + driver nodes. */
  readonly score?: number;
  readonly tone: GraphTone;
  /** Present on cause nodes whose fix maps to a next-best-action candidate. */
  readonly impact?: NodeImpact;
  /** Deep-link to the entity/section this node represents. */
  readonly link?: string;
  readonly column: GraphColumn;
  /** Filled by layoutGraph — the top-left of the node box. */
  readonly x?: number;
  readonly y?: number;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  /** 0–1; drives stroke width. */
  readonly weight: number;
  readonly label?: string;
  readonly tone: GraphTone;
}

export interface CausalGraph {
  readonly kind: "causal";
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly health: { readonly score: number; readonly band: string };
}

export interface FlowGraph {
  readonly kind: "flow";
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export type PartnershipGraph = CausalGraph | FlowGraph;

/** A graph whose nodes are guaranteed to have x/y (output of layoutGraph). */
export interface PositionedNode extends GraphNode {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PositionedGraph {
  readonly kind: "causal" | "flow";
  readonly nodes: readonly PositionedNode[];
  readonly edges: readonly GraphEdge[];
  readonly width: number;
  readonly height: number;
}
