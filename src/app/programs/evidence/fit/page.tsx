import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { RingGauge } from "@/components/ui/RingGauge";
import { EmptyState } from "@/components/ui/EmptyState";
import { MutationForm } from "@/components/ui/MutationForm";
import { pursueProgram } from "@/domain/programs/actions";
import { FUNDING_FIT_LABELS } from "@/domain/programs/library";
import { loadProgramFit } from "@/domain/evidence/fit-load";
import { FIT_BAND_LABELS, type FitBand, type RequirementCoverage } from "@/domain/evidence/fit";

/**
 * The Evidence Locker "Program Fit" dashboard: actively evaluates the tenant's
 * evidence against the whole AWS program catalog, shows per-requirement deltas
 * (met / partial / gap), and ranks which programs best fit — with a one-click
 * "Pursue" that adopts the program and auto-links the evidence already on file.
 * Server-rendered over the RLS loader; the only client islands are the CTAs.
 */

const TYPE_LABELS: Record<string, string> = {
  case_study: "a case study",
  certification: "a certification",
  architecture: "an architecture review",
  security: "security documentation",
  billing: "a billing/Marketplace record",
  reference: "a reference doc",
  other: "an artifact",
};

function reqTone(state: RequirementCoverage["state"]): Tone {
  return state === "met" ? "ok" : state === "partial" ? "warn" : "danger";
}
function bandTone(band: FitBand): Tone {
  return band === "ready" ? "ok" : band === "close" ? "info" : band === "emerging" ? "warn" : "neutral";
}
function fundingTone(fit: string): Tone {
  return fit === "high" ? "ok" : fit === "medium" ? "info" : "neutral";
}
function ringColor(pct: number): string {
  return pct >= 75 ? "var(--ok)" : pct >= 40 ? "var(--warn)" : "var(--danger)";
}

export default async function ProgramFitPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const today = new Date().toISOString().slice(0, 10);
  const view = await loadProgramFit(identity, today);

  return (
    <PageShell>
      <PageHeader
        title="Program Fit"
        subtitle="Which AWS competencies and specializations your evidence qualifies you for — and the deltas to close."
        back={{ href: "/programs/evidence", label: "Evidence Locker" }}
      />

      {!view.hasEvidence ? (
        <Panel>
          <EmptyState
            title="No evidence yet"
            hint="Upload evidence to the locker and we'll show which AWS programs you're closest to — and exactly what's missing for each."
            action={
              <Link href="/programs/evidence" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
                Go to the Evidence Locker →
              </Link>
            }
          />
        </Panel>
      ) : (
        <>
          {view.summary.bestNext && (
            <Panel title="Readiness">
              <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
                <RingGauge
                  value={view.summary.bestNext.coveragePercent}
                  label={`${view.summary.bestNext.coveragePercent}%`}
                  caption="coverage"
                  color={ringColor(view.summary.bestNext.coveragePercent)}
                />
                <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
                  <div>
                    Best next program: <strong>{view.summary.bestNext.name}</strong>
                  </div>
                  <div style={{ color: "var(--muted)" }}>
                    <strong style={{ color: "var(--text)" }}>{view.summary.readyToPursue.length}</strong>{" "}
                    ready to pursue ·{" "}
                    <strong style={{ color: "var(--text)" }}>{view.summary.totalGaps}</strong> total
                    gaps across the catalog
                  </div>
                </div>
              </div>
            </Panel>
          )}

          <div style={{ display: "grid", gap: 12 }}>
            {view.fits.map((f) => {
              const adopted = view.adoptedKeys.has(f.programKey);
              return (
                <Card key={f.programKey}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 14,
                      flexWrap: "wrap",
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ display: "grid", gap: 8 }}>
                      <strong style={{ fontSize: 15 }}>{f.name}</strong>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Badge>{f.programType}</Badge>
                        <Badge>{f.deliveryModel}</Badge>
                        <Badge tone={fundingTone(f.fundingFit)}>
                          {FUNDING_FIT_LABELS[f.fundingFit] ?? f.fundingFit}
                        </Badge>
                        <Badge tone={bandTone(f.fitBand)}>{FIT_BAND_LABELS[f.fitBand]}</Badge>
                        {adopted && <Badge tone="ok">In portfolio</Badge>}
                      </div>
                    </div>
                    <RingGauge
                      value={f.coveragePercent}
                      label={`${f.coveragePercent}%`}
                      caption="covered"
                      size={84}
                      thickness={9}
                      color={ringColor(f.coveragePercent)}
                    />
                  </div>

                  <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted)" }}>
                    <strong style={{ color: "var(--text)" }}>{f.metCount}</strong> met · {f.partialCount}{" "}
                    partial ·{" "}
                    <span style={{ color: f.gapCount > 0 ? "var(--danger)" : "var(--muted)" }}>
                      {f.gapCount} gap
                    </span>
                  </p>

                  <ul
                    style={{
                      listStyle: "none",
                      margin: "10px 0 0",
                      padding: 0,
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    {f.requirements.map((r) => (
                      <li
                        key={r.key}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: 13 }}>
                          {r.label}{" "}
                          <span style={{ color: "var(--muted)", fontSize: 12 }}>
                            · expects {TYPE_LABELS[r.expectedEvidenceType] ?? r.expectedEvidenceType}
                          </span>
                        </span>
                        <Badge tone={reqTone(r.state)} title={r.reason}>
                          {r.state}
                        </Badge>
                      </li>
                    ))}
                  </ul>

                  {adopted ? (
                    <p style={{ margin: "12px 0 0", fontSize: 12 }}>
                      <Link href="/programs" style={{ color: "var(--accent)", textDecoration: "none" }}>
                        Open in Program Management →
                      </Link>
                    </p>
                  ) : (
                    <div style={{ marginTop: 12 }}>
                      <MutationForm
                        action={pursueProgram}
                        submitLabel="Pursue this competency"
                        hidden={{ libraryKey: f.programKey }}
                      />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </PageShell>
  );
}
