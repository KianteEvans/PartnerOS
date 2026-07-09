import type { ReactNode } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { RENEWAL_BAND_LABELS, type RenewalBand } from "@/domain/solutions/renewal";
import { renewalAxis, type RenewalTimelineInput } from "@/domain/solutions/timeline";

const BAND_COLOR: Record<RenewalBand, string> = {
  compliant: "var(--ok)",
  at_risk: "var(--warn)",
  non_compliant: "var(--danger)",
};
const bandTone = (b: RenewalBand) => (b === "compliant" ? "ok" : b === "at_risk" ? "warn" : "danger");

/** A horizontal renewal calendar: each dated Solution plotted on a shared date axis,
 *  band-coloured, with a "today" marker; undated Solutions are listed separately. */
export function SolutionRenewalTimeline({
  items,
  today,
}: {
  items: readonly RenewalTimelineInput[];
  today: string;
}): ReactNode {
  const axis = renewalAxis(items, today);

  return (
    <Panel title="Renewal timeline" accent="var(--section-accent)">
      {axis.points.length === 0 ? (
        <EmptyState
          title="No renewal dates yet"
          hint="Set a renewal date on a Solution to plot it here."
        />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginBottom: 8, paddingLeft: "calc(clamp(104px, 28vw, 164px) + 8px)" }}>
            <span>{axis.start}</span>
            <span>{axis.end}</span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {axis.points.map((p) => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "clamp(104px, 28vw, 164px) 1fr clamp(64px, 16vw, 92px)", gap: 8, alignItems: "center", fontSize: 13 }}>
                <Link
                  href={`/programs/solutions/${p.id}`}
                  title={p.title}
                  style={{ color: "var(--accent)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {p.title}
                </Link>
                <div style={{ position: "relative", height: 16, background: "var(--border)", borderRadius: 999 }}>
                  <div
                    title={`today ${today}`}
                    style={{ position: "absolute", left: `${axis.todayPct}%`, top: -3, bottom: -3, width: 2, background: "var(--muted)", opacity: 0.6 }}
                  />
                  <div
                    title={`${RENEWAL_BAND_LABELS[p.band]} · ${p.date}`}
                    style={{ position: "absolute", left: `calc(${p.pct}% - 7px)`, top: 1, width: 14, height: 14, borderRadius: "50%", background: BAND_COLOR[p.band], border: "2px solid var(--panel)" }}
                  />
                </div>
                <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{p.date}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--muted)" }}>Dot colour = renewal band · grey line = today.</p>
        </>
      )}

      {axis.undated.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <strong style={{ fontSize: 12, color: "var(--muted)" }}>No renewal date ({axis.undated.length})</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            {axis.undated.map((u) => (
              <Link key={u.id} href={`/programs/solutions/${u.id}`} style={{ textDecoration: "none" }}>
                <Badge tone={bandTone(u.band)}>{u.title}</Badge>
              </Link>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
