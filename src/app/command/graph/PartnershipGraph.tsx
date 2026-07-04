"use client";

import { useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { connectedSet } from "@/domain/graph/layout";
import type { GraphTone, PositionedGraph, PositionedNode } from "@/domain/graph/types";

/**
 * Interactive Partnership Graph island. Receives a fully-positioned graph (plain JSON from
 * the pure builders + layoutGraph) and renders it as an SVG the user can explore: hover a
 * node to highlight the cause→driver→health (or source→flow→sink) path it sits on, click to
 * deep-link to the entity, filter to one domain, and zoom/pan. All the "why" logic is pure
 * and server-computed; this island only owns interaction state.
 */

const TONE_VAR: Record<GraphTone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  info: "var(--info)",
  neutral: "var(--muted)",
  accent: "var(--section-accent)",
};
const TONES: readonly GraphTone[] = ["ok", "warn", "danger", "info", "neutral", "accent"];

function clampText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const chip = (active: boolean): CSSProperties => ({
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 12,
  cursor: "pointer",
  border: "1px solid var(--border)",
  background: active ? "var(--section-accent)" : "transparent",
  color: active ? "var(--accent-ink)" : "var(--muted)",
  fontWeight: active ? 600 : 400,
});

const zoomBtn: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 15,
  lineHeight: 1,
};

export function PartnershipGraph({ graph }: { graph: PositionedGraph }): ReactNode {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  // Filter chips: the driver nodes (causal) or the named domain hubs (flow).
  const filters = useMemo(() => {
    if (graph.kind === "causal") {
      return graph.nodes.filter((n) => n.kind === "driver").map((n) => ({ id: n.id, label: n.label }));
    }
    const hubIds = new Set(["mdf", "evidence", "marketplace", "ace", "tier", "roi", "solutions"]);
    return graph.nodes.filter((n) => hubIds.has(n.id)).map((n) => ({ id: n.id, label: n.label }));
  }, [graph]);

  const highlight = hovered ? connectedSet(graph.edges, hovered) : null;
  const visible = filter ? connectedSet(graph.edges, filter) : null;

  const isVisible = (id: string) => !visible || visible.has(id);
  const isDim = (id: string) => highlight !== null && !highlight.has(id);
  const edgeShown = (from: string, to: string) => isVisible(from) && isVisible(to);
  const edgeDim = (from: string, to: string) =>
    highlight !== null && !(highlight.has(from) && highlight.has(to));

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(2.5, Math.max(0.5, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  };
  const onDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    setPan({ x: drag.current.panX + (e.clientX - drag.current.x), y: drag.current.panY + (e.clientY - drag.current.y) });
  };
  const endDrag = () => {
    drag.current = null;
  };

  const go = (link: string | undefined) => {
    if (link) router.push(link);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={chip(filter === null)} onClick={() => setFilter(null)}>
            All
          </button>
          {filters.map((f) => (
            <button key={f.id} type="button" style={chip(filter === f.id)} onClick={() => setFilter((cur) => (cur === f.id ? null : f.id))}>
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" aria-label="Zoom out" style={zoomBtn} onClick={() => setZoom((z) => Math.max(0.5, z * 0.9))}>
            −
          </button>
          <button type="button" aria-label="Zoom in" style={zoomBtn} onClick={() => setZoom((z) => Math.min(2.5, z * 1.1))}>
            +
          </button>
          <button
            type="button"
            aria-label="Reset view"
            style={{ ...zoomBtn, width: "auto", padding: "0 10px", fontSize: 12 }}
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--panel-2)",
          overflow: "hidden",
          cursor: drag.current ? "grabbing" : "grab",
        }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onWheel={onWheel}
      >
        <svg
          width="100%"
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          role="img"
          aria-label={graph.kind === "causal" ? "Partnership health causal map" : "Cross-domain attribution flow"}
          style={{ display: "block", userSelect: "none" }}
        >
          <defs>
            {TONES.map((t) => (
              <marker key={t} id={`g-arw-${t}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill={TONE_VAR[t]} />
              </marker>
            ))}
          </defs>

          {/* Zoom/pan group holds the whole diagram (edges under nodes). */}
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {graph.edges.map((e, i) => {
              const s = nodeById.get(e.from);
              const t = nodeById.get(e.to);
              if (!s || !t || !edgeShown(e.from, e.to)) return null;
              const sx = s.x + s.w;
              const sy = s.y + s.h / 2;
              const tx = t.x;
              const ty = t.y + t.h / 2;
              const dx = Math.max(30, (tx - sx) * 0.4);
              return (
                <g key={`e${i}`} opacity={edgeDim(e.from, e.to) ? 0.12 : 1}>
                  <path
                    d={`M ${sx},${sy} C ${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}`}
                    fill="none"
                    stroke={TONE_VAR[e.tone]}
                    strokeWidth={1 + e.weight * 4}
                    markerEnd={`url(#g-arw-${e.tone})`}
                  />
                  {e.label && (
                    <text x={(sx + tx) / 2} y={(sy + ty) / 2 - 4} textAnchor="middle" style={{ fontSize: 10, fill: "var(--muted)", pointerEvents: "none" }}>
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
            {graph.nodes.filter((n) => isVisible(n.id)).map((n) => (
              <GraphNodeBox
                key={n.id}
                node={n}
                dim={isDim(n.id)}
                onEnter={() => setHovered(n.id)}
                onLeave={() => setHovered(null)}
                onActivate={() => go(n.link)}
              />
            ))}
          </g>
        </svg>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
        Hover a node to trace its path · click to open · scroll to zoom, drag to pan. Advisory — every node links to where the work lives.
      </p>
    </div>
  );
}

function GraphNodeBox({
  node,
  dim,
  onEnter,
  onLeave,
  onActivate,
}: {
  node: PositionedNode;
  dim: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onActivate: () => void;
}): ReactNode {
  const tone = TONE_VAR[node.tone];
  const isHealth = node.kind === "health";
  return (
    <g
      transform={`translate(${node.x} ${node.y})`}
      opacity={dim ? 0.25 : 1}
      role="link"
      tabIndex={0}
      aria-label={`${node.label}${node.sublabel ? `, ${node.sublabel}` : ""}`}
      style={{ cursor: node.link ? "pointer" : "default", outline: "none" }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      <rect
        width={node.w}
        height={node.h}
        rx={9}
        fill="var(--panel)"
        stroke={tone}
        strokeWidth={isHealth ? 2.5 : 1.5}
      />
      <rect width={4} height={node.h} rx={2} fill={tone} />
      <text x={12} y={isHealth ? 21 : 19} style={{ fontSize: 12.5, fontWeight: 700, fill: "var(--text)" }}>
        {clampText(node.label, 22)}
      </text>
      {isHealth && node.score !== undefined ? (
        <text x={node.w - 12} y={31} textAnchor="end" style={{ fontSize: 22, fontWeight: 800, fill: tone }}>
          {node.score}
        </text>
      ) : null}
      {node.sublabel && (
        <text x={12} y={34} style={{ fontSize: 10.5, fill: "var(--muted)" }}>
          {clampText(node.sublabel, isHealth ? 16 : 26)}
        </text>
      )}
      {(() => {
        const im = node.impact;
        if (!im) return null;
        const [text, color] =
          im.healthDelta > 0
            ? [`▲ ${im.healthDelta} health`, "var(--ok)"]
            : im.tierPctDelta > 0
              ? [`▲ ${im.tierPctDelta}% tier`, "var(--section-accent)"]
              : im.queueDelta > 0
                ? [`− ${im.queueDelta} alert${im.queueDelta === 1 ? "" : "s"}`, "var(--info)"]
                : [null, ""];
        return text ? (
          <text x={node.w - 10} y={node.h - 8} textAnchor="end" style={{ fontSize: 10.5, fontWeight: 700, fill: color }}>
            {text}
          </text>
        ) : null;
      })()}
    </g>
  );
}
