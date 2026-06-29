import type { ReactNode } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge, statusTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { GATE_LABELS } from "@/domain/programs/gate";
import type { PursuitItem } from "@/domain/programs/pursue";

/**
 * The Pursue headline: a live, ranked tracker of the competencies the org is closest
 * to earning (in-flight programs by readiness %). Server-rendered, so it reflects the
 * current requirement/evidence state on every load — no polling.
 */
export function PursuitTracker({ items }: { items: readonly PursuitItem[] }): ReactNode {
  return (
    <Panel title="In pursuit">
      {items.length === 0 ? (
        <EmptyState
          title="No programs in active pursuit"
          hint="Adopt a competency from the library to start tracking your path to earning it."
          action={
            <Link href="/programs?view=available" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600, fontSize: 13 }}>
              Browse the library →
            </Link>
          }
        />
      ) : (
        <>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
            The {items.length} {items.length === 1 ? "competency" : "competencies"} you&apos;re closest to earning —
            updates live as evidence and requirements change.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {items.map((p, i) => {
              const done = p.percent >= 100;
              return (
                <Link key={p.id} href={`/programs/${p.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <Card compact interactive style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                        <span
                          style={{
                            flexShrink: 0,
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            display: "grid",
                            placeItems: "center",
                            background: "var(--panel-2)",
                            border: "1px solid var(--border)",
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: "var(--muted)",
                          }}
                        >
                          {i + 1}
                        </span>
                        <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.name}
                        </span>
                      </span>
                      <Badge tone={statusTone(p.gate)} title={GATE_LABELS[p.gate]}>
                        {GATE_LABELS[p.gate]}
                      </Badge>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ width: `${p.percent}%`, height: "100%", background: done ? "var(--ok)" : "var(--accent-2)", borderRadius: 999 }} />
                      </div>
                      <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                        {p.met}/{p.total} · {p.percent}%
                      </span>
                    </div>

                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      {p.programType} · {p.status}
                    </span>
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}
