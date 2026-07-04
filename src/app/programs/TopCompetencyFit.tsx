import type { ReactNode } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Badge, type Tone } from "@/components/ui/Badge";
import { RingGauge } from "@/components/ui/RingGauge";
import { MutationForm } from "@/components/ui/MutationForm";
import { pursueProgram } from "@/domain/programs/actions";
import { FIT_BAND_LABELS, type FitBand, type ProgramFit } from "@/domain/evidence/fit";

/**
 * The Pursue-tab headline: the top 5 AWS Competencies the tenant's evidence best
 * aligns to, ranked by the evidence-locker fit engine. A prominent shortlist of
 * "what to pursue next", each with its coverage and a one-click Pursue, linking
 * into the full Program Fit view (`/programs?view=fit`). Pure presentation over
 * the already-ranked `loadProgramFit` output.
 */

const BAND_TONE: Record<FitBand, Tone> = {
  ready: "ok",
  close: "info",
  emerging: "warn",
  exploratory: "neutral",
};
function ringColor(pct: number): string {
  return pct >= 75 ? "var(--ok)" : pct >= 40 ? "var(--warn)" : "var(--danger)";
}

export function TopCompetencyFit({
  fits,
  adoptedKeys,
  hasEvidence,
}: {
  fits: readonly ProgramFit[];
  adoptedKeys: ReadonlySet<string>;
  hasEvidence: boolean;
}): ReactNode {
  // "Competencies" specifically (fits are already sorted best-first).
  const top = fits.filter((f) => f.programType === "Competency").slice(0, 5);

  return (
    <Panel
      title="Top competency fit"
      accent="var(--section-accent)"
      actions={
        <Link
          href="/programs?view=fit"
          style={{ color: "var(--accent)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}
        >
          View full Program Fit →
        </Link>
      }
    >
      {top.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 13 }}>
          {hasEvidence ? (
            "No competencies align with your evidence yet — keep adding artifacts to the locker."
          ) : (
            <>
              Add evidence to the locker to surface your best-fit competencies.{" "}
              <Link href="/programs?view=fit" style={{ color: "var(--accent)" }}>
                See Program Fit →
              </Link>
            </>
          )}
        </p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {top.map((f, i) => {
            const adopted = adoptedKeys.has(f.programKey);
            const total = f.metCount + f.partialCount + f.gapCount;
            return (
              <div
                key={f.programKey}
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "center",
                  flexWrap: "wrap",
                  paddingBottom: 10,
                  borderBottom: i < top.length - 1 ? "1px solid var(--border)" : "none",
                }}
              >
                <RingGauge
                  value={f.coveragePercent}
                  label={`${f.coveragePercent}%`}
                  caption="covered"
                  size={58}
                  thickness={7}
                  color={ringColor(f.coveragePercent)}
                />
                <div style={{ flex: 1, minWidth: 200, display: "grid", gap: 4 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 14 }}>{f.name}</strong>
                    <Badge tone={BAND_TONE[f.fitBand]}>{FIT_BAND_LABELS[f.fitBand]}</Badge>
                    {adopted && <Badge tone="info">In portfolio</Badge>}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    {f.metCount} of {total} requirements met
                    {f.gapCount > 0 ? ` · ${f.gapCount} gap${f.gapCount === 1 ? "" : "s"}` : ""}
                  </span>
                </div>
                <div>
                  {adopted ? (
                    <Link
                      href="/programs"
                      style={{ color: "var(--accent)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}
                    >
                      Open →
                    </Link>
                  ) : (
                    <MutationForm
                      action={pursueProgram}
                      submitLabel="Pursue"
                      variant="secondary"
                      hidden={{ libraryKey: f.programKey }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
