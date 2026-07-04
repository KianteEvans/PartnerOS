import type { ReactNode } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { Badge, type Tone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { createSolution } from "@/domain/solutions/actions";
import { RENEWAL_BAND_LABELS, renewalSummary, type RenewalBand } from "@/domain/solutions/renewal";
import {
  SOLUTION_TYPE_OPTIONS,
  SOLUTION_TYPE_LABELS,
  solutionTypeLabel,
  availabilityLabel,
  PROGRAM_TYPE_OPTIONS,
} from "@/domain/solutions/labels";
import type { SolutionListItem } from "@/domain/solutions/load";
import { SolutionRenewalTimeline } from "@/app/programs/SolutionRenewalTimeline";

const labelStyle = { display: "grid", gap: 4, fontSize: 12 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 8px",
  color: "var(--text)",
  fontSize: 13,
} as const;

function bandTone(b: RenewalBand): Tone {
  return b === "compliant" ? "ok" : b === "at_risk" ? "warn" : "danger";
}

function availabilityTone(a: string): Tone {
  return a === "available" ? "ok" : a === "beta" ? "info" : "danger";
}

/**
 * Solutions live inside Program Management as the "Solutions & renewal" view: a
 * Solution is the maintained fruit of a competency/specialization, so its renewal
 * readiness sits alongside the portfolio you achieve and must keep current. Rendered
 * by `/programs?view=solutions` (body only — the Programs page owns the header + pills).
 */
export function SolutionsView({
  items,
  today,
  layout = "grid",
  programOptions = [],
}: {
  items: readonly SolutionListItem[];
  today: string;
  layout?: "grid" | "timeline";
  /** Adopted competencies offered as the optional owning-program link. */
  programOptions?: ReadonlyArray<{ id: string; name: string }>;
}): ReactNode {
  const summary = renewalSummary(
    items.map((i) => ({ band: i.band, criteria: [], gapCount: 0, dueInDays: null })),
  );

  const drawer = (
    <FormDrawer
      triggerLabel="New Solution"
      title="New Solution"
      action={createSolution}
      submitLabel="Create"
      successMessage="Solution created."
    >
      <label style={labelStyle}>
        <span style={spanStyle}>Title</span>
        <input name="title" required maxLength={250} placeholder="e.g. Acme Threat Detection Platform" style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Solution type</span>
        <select name="solutionType" defaultValue="consulting_service" style={controlStyle}>
          {SOLUTION_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {SOLUTION_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Validated for (program)</span>
        <input name="programType" list="program-types" maxLength={60} placeholder="e.g. Competency" style={controlStyle} />
        <datalist id="program-types">
          {PROGRAM_TYPE_OPTIONS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      {programOptions.length > 0 && (
        <label style={labelStyle}>
          <span style={spanStyle}>Owning competency</span>
          <select name="programId" defaultValue="" style={controlStyle}>
            <option value="">None</option>
            {programOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </FormDrawer>
  );

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, maxWidth: 660 }}>
          Your validated AWS Specialization Solutions — track renewal readiness (Active · tier · FTR · launched
          ACE opportunities) before AWS does.
        </p>
        {items.length > 0 && drawer}
      </div>

      {items.length === 0 ? (
        <Panel>
          <EmptyState
            title="No Solutions yet"
            hint="Create the validated Solution behind a Specialization, then link it to its application and the ACE opportunities it launches."
            action={drawer}
          />
        </Panel>
      ) : (
        <>
          <MetricStrip>
            <MetricCard label="Solutions" value={String(summary.total)} sub="validated" />
            <MetricCard
              label="Compliant"
              value={String(summary.total - summary.atRisk - summary.nonCompliant)}
              tone="ok"
              sub="renewal-ready"
            />
            <MetricCard
              label="At risk"
              value={String(summary.atRisk)}
              tone={summary.atRisk > 0 ? "warn" : "neutral"}
              sub="renewal gap"
            />
            <MetricCard
              label="Not compliant"
              value={String(summary.nonCompliant)}
              tone={summary.nonCompliant > 0 ? "danger" : "neutral"}
              tint={summary.nonCompliant > 0 ? "danger" : undefined}
              sub="needs action"
            />
          </MetricStrip>

          <nav aria-label="Solutions layout" style={{ display: "flex" }}>
            <SegmentedControl
              size="sm"
              options={[
                { value: "grid", label: "Grid" },
                { value: "timeline", label: "Timeline" },
              ]}
              value={layout}
              hrefFor={(l) => `/programs?view=solutions&layout=${l}`}
            />
          </nav>

          {layout === "timeline" ? (
            <SolutionRenewalTimeline items={items} today={today} />
          ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {items.map((s) => (
              <Card key={s.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Link
                    href={`/programs/solutions/${s.id}`}
                    style={{ color: "var(--accent)", textDecoration: "none", fontSize: 15, fontWeight: 600 }}
                  >
                    {s.title}
                  </Link>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <Badge tone={availabilityTone(s.availability)}>{availabilityLabel(s.availability)}</Badge>
                    <Badge tone={bandTone(s.band)}>{RENEWAL_BAND_LABELS[s.band]}</Badge>
                  </div>
                </div>
                <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 0" }}>
                  {solutionTypeLabel(s.solutionType)}
                  {s.programType ? ` · ${s.programType}` : ""} · {s.launchedCount} launched ACE{" "}
                  {s.launchedCount === 1 ? "opportunity" : "opportunities"} (12mo)
                  {s.programId && s.programName ? (
                    <>
                      {" · "}
                      <Link href={`/programs/${s.programId}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
                        {s.programName}
                      </Link>
                    </>
                  ) : null}
                </p>
              </Card>
            ))}
          </div>
          )}
        </>
      )}
    </>
  );
}
