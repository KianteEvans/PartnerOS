import type { GraphEdge, PartnershipGraph, PositionedGraph, PositionedNode } from "@/domain/graph/types";

/**
 * Pure, deterministic layout for a graph: assigns each node an (x, y, w, h) by its column,
 * evenly distributing nodes within a column and centering short columns vertically. Plus
 * `connectedSet` — the ancestor+descendant closure of a node, used by the interactive island
 * to highlight a cause→driver→health path on hover. Keeping this pure means the layout and
 * highlight logic are unit-tested and out of the client bundle's untested surface.
 */

export const NODE_W = 172;
export const NODE_H = 48;
const PAD = 26;
const ROW_GAP = 20;
export const CANVAS_W = 920;
const MIN_H = 320;
const ROW_H = NODE_H + ROW_GAP;

const CAUSAL_COLUMNS = ["cause", "driver", "root"] as const;
const FLOW_COLUMNS = ["source", "flow", "sink"] as const;

export function layoutGraph(graph: PartnershipGraph): PositionedGraph {
  const columns: readonly string[] = graph.kind === "causal" ? CAUSAL_COLUMNS : FLOW_COLUMNS;
  const colIndex = new Map(columns.map((c, i) => [c, i]));

  // Bucket nodes by column, preserving the builder's order (already grouped sensibly).
  const buckets: (typeof graph.nodes[number])[][] = columns.map(() => []);
  for (const n of graph.nodes) {
    const ci = colIndex.get(n.column) ?? 0;
    buckets[ci]?.push(n);
  }

  const maxK = Math.max(1, ...buckets.map((b) => b.length));
  const height = Math.max(MIN_H, PAD * 2 + maxK * ROW_H - ROW_GAP);
  const step = columns.length > 1 ? (CANVAS_W - NODE_W - PAD * 2) / (columns.length - 1) : 0;

  const nodes: PositionedNode[] = [];
  buckets.forEach((bucket, ci) => {
    const colHeight = bucket.length * ROW_H - ROW_GAP;
    const startY = Math.max(PAD, (height - colHeight) / 2);
    const x = PAD + ci * step;
    bucket.forEach((n, i) => {
      nodes.push({ ...n, x, y: startY + i * ROW_H, w: NODE_W, h: NODE_H });
    });
  });

  return { kind: graph.kind, nodes, edges: graph.edges, width: CANVAS_W, height };
}

/**
 * The connected closure of `nodeId`: itself plus every ancestor (following edges backward)
 * and every descendant (following edges forward). Used to highlight the full cause→driver→
 * health (or source→flow→sink) path a hovered node participates in.
 */
export function connectedSet(edges: readonly GraphEdge[], nodeId: string): Set<string> {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, val: string) => {
    const arr = map.get(key);
    if (arr) arr.push(val);
    else map.set(key, [val]);
  };
  for (const e of edges) {
    add(outgoing, e.from, e.to);
    add(incoming, e.to, e.from);
  }
  const result = new Set<string>([nodeId]);
  const walk = (adj: Map<string, string[]>) => {
    const stack = [nodeId];
    while (stack.length > 0) {
      const n = stack.pop() as string;
      for (const m of adj.get(n) ?? []) {
        if (!result.has(m)) {
          result.add(m);
          stack.push(m);
        }
      }
    }
  };
  walk(outgoing); // descendants
  walk(incoming); // ancestors
  return result;
}
