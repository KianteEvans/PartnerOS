import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { deferAfterResponse } from "@/http/defer";
import { roadmaps, roadmapMilestones, users, programs, tierRequirements, tenants } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, statusTone, type Tone } from "@/components/ui/Badge";
import { RingGauge } from "@/components/ui/RingGauge";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { Callout } from "@/components/ui/Callout";
import { MutationForm } from "@/components/ui/MutationForm";
import { FormDrawer } from "@/components/ui/FormDrawer";
import {
  finalizeRoadmap,
  recomposeRoadmap,
  duplicateRoadmap,
  reopenRoadmap,
  replanRoadmap,
} from "@/domain/roadmaps/actions";
import { PROGRAM_LIBRARY } from "@/domain/programs/library";
import { TIER_LABELS, tiersAbove, thresholdsForTier, type TierId } from "@/domain/tiers/catalog";
import {
  targetTierFromMilestones,
  tierCoverage,
  type CoverageState,
  type CoverageSummary,
} from "@/domain/roadmaps/coverage";
import { captureRoadmapSnapshot, loadRoadmapTrends } from "@/domain/roadmaps/trends-load";
import { reconcileMilestonesOp } from "@/domain/roadmaps/operations";
import { can, type Role } from "@/authz/permissions";
import type { MutationContext } from "@/gate/mutation-gate";
import { computeForecast } from "@/domain/roadmaps/forecast";
import { loadRoadmapRecommendations } from "@/domain/roadmaps/recommend-load";
import { RoadmapTrajectory } from "@/app/plan/roadmaps/RoadmapTrajectory";
import { RoadmapNarrative } from "@/components/ui/RoadmapNarrative";
import { env } from "@/env";

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
const secBtnStyle = {
  background: "transparent",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 16px",
  fontWeight: 600,
  fontSize: 13,
  textDecoration: "none",
  cursor: "pointer",
} as const;
const HORIZONS = Object.keys(HORIZON_LABELS) as HorizonId[];
const SCENARIOS = Object.keys(SCENARIO_LABELS) as ScenarioId[];
import {
  HORIZON_LABELS,
  SCENARIO_LABELS,
  type HorizonId,
  type ScenarioId,
} from "@/domain/roadmaps/planner";
import { MilestoneViews } from "@/app/plan/roadmaps/MilestoneViews";
import { RoadmapProgressHeader } from "@/app/plan/roadmaps/RoadmapProgressHeader";
import { roadmapProgress } from "@/domain/roadmaps/progress";

export default async function RoadmapDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");

  const data = await withTenant(identity, async (tx) => {
    const [roadmap] = await tx
      .select()
      .from(roadmaps)
      .where(and(eq(roadmaps.id, id), eq(roadmaps.tenantId, identity.tenantId)));
    if (!roadmap) return null;
    // Live reconciliation: auto-advance satisfied program/tier milestones to done
    // (best-effort, write-gated to roadmap:update users) so the plan reflects reality
    // the moment it's viewed. Runs before the milestone read below so it reflects the
    // advancement; errors never break the page.
    let reconciled: readonly { title: string; reason: string }[] = [];
    if (can(identity.role as Role, "roadmap:update")) {
      try {
        const res = await reconcileMilestonesOp({ identity, tx } as MutationContext, { roadmapId: id });
        reconciled = res.advanced;
      } catch {
        // swallow — a living plan should never take down its own page.
      }
    }
    const milestones = await tx
      .select()
      .from(roadmapMilestones)
      .where(
        and(
          eq(roadmapMilestones.roadmapId, id),
          eq(roadmapMilestones.tenantId, identity.tenantId),
        ),
      )
      .orderBy(asc(roadmapMilestones.sequence));
    const members = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.tenantId, identity.tenantId));
    const adoptedPrograms = await tx
      .select({ libraryKey: programs.libraryKey, id: programs.id, status: programs.status })
      .from(programs)
      .where(eq(programs.tenantId, identity.tenantId));
    const tierReqs = await tx
      .select({
        key: tierRequirements.requirementKey,
        currentValue: tierRequirements.currentValue,
        threshold: tierRequirements.threshold,
        unit: tierRequirements.unit,
      })
      .from(tierRequirements)
      .where(eq(tierRequirements.tenantId, identity.tenantId));
    const [tenantRow] = await tx
      .select({ tier: tenants.tier })
      .from(tenants)
      .where(eq(tenants.id, identity.tenantId));
    return {
      roadmap,
      milestones,
      members,
      adoptedPrograms,
      tierReqs,
      currentTier: (tenantRow?.tier ?? "registered") as TierId,
      reconciled,
    };
  });

  if (!data) notFound();
  const { roadmap, milestones, members, adoptedPrograms, tierReqs, currentTier, reconciled } =
    data;
  const isDraft = roadmap.status === "draft";
  const tierOptions = tiersAbove(currentTier).map((tid) => ({
    id: tid,
    label: TIER_LABELS[tid],
  }));
  const today = new Date().toISOString().slice(0, 10);
  const prog = roadmapProgress(milestones, today);

  // Theme A: tier-readiness coverage — null when this roadmap targets no tier.
  const targetTier = targetTierFromMilestones(milestones);
  const cov = targetTier ? tierCoverage(milestones, thresholdsForTier(targetTier), targetTier) : null;

  // Theme B: record today's burn-up point (best-effort, deferred past the
  // response) and forecast the trajectory; today's point is overlaid in memory
  // so the burn-up still ends at "now" before the write lands.
  if (milestones.length > 0) {
    await deferAfterResponse(() =>
      captureRoadmapSnapshot(
        identity,
        roadmap.id,
        { done: prog.done, total: prog.total, overdue: prog.overdue, inProgress: prog.inProgress },
        today,
      ),
    );
  }
  const stored = milestones.length > 0 ? await loadRoadmapTrends(identity, roadmap.id) : [];
  const series =
    milestones.length === 0
      ? stored
      : stored[stored.length - 1]?.capturedOn === today
        ? [...stored.slice(0, -1), { capturedOn: today, done: prog.done }]
        : [...stored, { capturedOn: today, done: prog.done }];
  const forecast = computeForecast({
    milestones: milestones.map((mm) => ({ status: mm.status, targetDate: mm.targetDate, title: mm.title })),
    snapshots: series,
    today,
  });
  const burnup = series.map((p) => p.done);

  // Theme C: programs worth adding (draft only; exclude ones already on the plan).
  const grow = isDraft
    ? await loadRoadmapRecommendations(
        identity,
        today,
        new Set(
          milestones
            .filter((mm) => mm.originKind === "program" && mm.originRef)
            .map((mm) => mm.originRef),
        ),
      )
    : null;

  // Roll real program / tier progress back onto each composed milestone.
  const programByKey = new Map(adoptedPrograms.map((p) => [p.libraryKey, p]));
  const reqByKey = new Map(tierReqs.map((r) => [r.key, r]));
  const progress: Record<string, { label: string; tone: Tone; href: string }> = {};
  for (const m of milestones) {
    if (m.originKind === "program" && m.originRef) {
      const p = programByKey.get(m.originRef);
      if (p) {
        progress[m.id] = {
          label: p.status,
          tone: statusTone(p.status),
          href: `/programs/${p.id}`,
        };
      }
    } else if (m.originKind === "tier" && m.originRef) {
      const reqKey = m.originRef.split(":")[1];
      const r = reqKey ? reqByKey.get(reqKey) : undefined;
      if (r) {
        progress[m.id] = {
          label: `${r.currentValue}/${r.threshold} ${r.unit}`,
          tone: r.currentValue >= r.threshold ? "ok" : "info",
          href: "/programs/tiers",
        };
      }
    }
  }

  return (
    <PageShell width={860}>
      <PageHeader
        breadcrumbs={[
          { href: "/", label: "Home" },
          { href: "/plan/roadmaps", label: "Roadmaps" },
          { label: roadmap.name },
        ]}
        title={roadmap.name}
        subtitle={
          <>
            {HORIZON_LABELS[roadmap.horizon as HorizonId]} ·{" "}
            {SCENARIO_LABELS[roadmap.scenario as ScenarioId]} · Start{" "}
            {roadmap.startDate} · {isDraft ? "Draft" : "Finalized"} · Source{" "}
            {roadmap.source}
          </>
        }
      />

      {reconciled.length > 0 && (
        <Callout
          tone="ok"
          title={`${reconciled.length} milestone${reconciled.length === 1 ? "" : "s"} auto-completed from live state`}
        >
          {reconciled.map((r) => `${r.title} (${r.reason.toLowerCase()})`).join("; ")}. These reflect your real
          program / tier state — adjust any in the milestone editor if needed.
        </Callout>
      )}

      {roadmap.objective && (
        <p style={{ fontSize: 14, margin: 0 }}>{roadmap.objective}</p>
      )}

      {milestones.length > 0 && (
        <Panel title="Progress" accent="var(--section-accent)">
          <RoadmapProgressHeader progress={prog} />
        </Panel>
      )}

      {cov && (
        <TierReadinessPanel
          cov={cov}
          tierLabel={TIER_LABELS[cov.tier]}
          isDraft={isDraft}
          roadmapId={roadmap.id}
          aiEnabled={Boolean(env.ANTHROPIC_API_KEY)}
        />
      )}

      {milestones.length > 0 && <RoadmapTrajectory forecast={forecast} series={burnup} />}

      <Panel title="Share & iterate" accent="var(--section-accent)">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <a href={`/plan/roadmaps/${roadmap.id}/export`} style={secBtnStyle}>
            Export CSV
          </a>
          <a
            href={`/plan/roadmaps/${roadmap.id}/print`}
            target="_blank"
            rel="noopener noreferrer"
            style={secBtnStyle}
          >
            Print / PDF
          </a>
          <MutationForm
            action={duplicateRoadmap}
            submitLabel="Duplicate"
            variant="secondary"
            hidden={{ roadmapId: roadmap.id }}
          />
          {isDraft ? (
            <FormDrawer
              triggerLabel="Re-plan timeline"
              triggerVariant="secondary"
              title="Re-plan timeline"
              action={replanRoadmap}
              submitLabel="Re-plan"
              successMessage="Timeline updated."
              hidden={{ roadmapId: roadmap.id }}
            >
              <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
                Re-spreads every milestone&apos;s target date across the new
                horizon. Order and content are unchanged.
              </p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label style={labelStyle}>
                  <span style={spanStyle}>Horizon</span>
                  <select name="horizon" defaultValue={roadmap.horizon} style={controlStyle}>
                    {HORIZONS.map((h) => (
                      <option key={h} value={h}>
                        {HORIZON_LABELS[h]}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle}>
                  <span style={spanStyle}>Scenario</span>
                  <select name="scenario" defaultValue={roadmap.scenario} style={controlStyle}>
                    {SCENARIOS.map((s) => (
                      <option key={s} value={s}>
                        {SCENARIO_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle}>
                  <span style={spanStyle}>Start date</span>
                  <input
                    name="startDate"
                    type="date"
                    defaultValue={roadmap.startDate}
                    style={controlStyle}
                  />
                </label>
              </div>
            </FormDrawer>
          ) : (
            <MutationForm
              action={reopenRoadmap}
              submitLabel="Re-open to draft"
              variant="secondary"
              hidden={{ roadmapId: roadmap.id }}
            />
          )}
        </div>
      </Panel>

      {!isDraft && (
        <Panel title="Finalized" accent="var(--section-accent)">
          <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>
            The structure is locked — keep the plan alive by updating each
            milestone&apos;s status. Each milestone was handed off as a task.{" "}
            <Link href="/command/tasks" style={{ color: "var(--accent)" }}>
              View tasks →
            </Link>
          </p>
        </Panel>
      )}

      <Panel title={`Milestones (${milestones.length})`} accent="var(--section-accent)">
        <MilestoneViews
          roadmapId={roadmap.id}
          isDraft={isDraft}
          milestones={milestones}
          members={members}
          progress={progress}
          startDate={roadmap.startDate}
          today={today}
        />
      </Panel>

      {isDraft && (
        <Panel title="Grow from catalog" accent="var(--section-accent)">
          <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
            Pull more AWS programs or a tier target into this draft. Anything
            already on the plan is skipped.
          </p>
          <FormDrawer
            triggerLabel="Add from catalog"
            triggerVariant="secondary"
            title="Add programs / tier"
            action={recomposeRoadmap}
            submitLabel="Add to plan"
            successMessage="Plan updated."
            hidden={{ roadmapId: roadmap.id }}
          >
            {grow && grow.recommendations.length > 0 ? (
              <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                <legend style={{ fontSize: 12, color: "var(--section-accent)", padding: 0, fontWeight: 600 }}>
                  Recommended for you
                </legend>
                {grow.recommendations.slice(0, 6).map((r) => (
                  <label key={r.key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input type="checkbox" name="programKeys" value={r.key} />
                    <span>{r.name}</span>
                    <Badge tone="info">{r.programType}</Badge>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <fieldset
              style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}
            >
              <legend style={{ fontSize: 12, color: "var(--muted)", padding: 0 }}>
                All programs &amp; competencies
              </legend>
              {PROGRAM_LIBRARY.map((p) => (
                <label
                  key={p.key}
                  style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}
                >
                  <input type="checkbox" name="programKeys" value={p.key} />
                  {p.name}
                </label>
              ))}
            </fieldset>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              <span style={{ color: "var(--muted)" }}>Target tier</span>
              <select
                name="targetTier"
                defaultValue=""
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "6px 8px",
                  color: "var(--text)",
                  fontSize: 13,
                }}
              >
                <option value="">No tier change</option>
                {tierOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </FormDrawer>
        </Panel>
      )}

      {isDraft && (
        <Panel title="Finalize" accent="var(--section-accent)">
          <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
            Finalizing locks the roadmap structure, creates one task per milestone
            (owners carry over), and — for composed roadmaps — adopts the selected
            programs and opens your tier plan. Their real progress then shows on
            each milestone, and you can still update statuses. This can&apos;t be
            undone.
          </p>
          <MutationForm
            action={finalizeRoadmap}
            submitLabel="Finalize & create tasks"
            hidden={{ roadmapId: roadmap.id }}
          />
        </Panel>
      )}
    </PageShell>
  );
}

const COVERAGE_TONE: Record<CoverageState, Tone> = {
  covered: "ok",
  in_progress: "info",
  planned: "neutral",
  uncovered: "danger",
};
const COVERAGE_LABEL: Record<CoverageState, string> = {
  covered: "Covered",
  in_progress: "In progress",
  planned: "Planned",
  uncovered: "Uncovered",
};
function tierRingColor(pct: number): string {
  return pct >= 75 ? "var(--ok)" : pct >= 40 ? "var(--warn)" : "var(--danger)";
}

/**
 * Tier-readiness panel: does this roadmap actually close the gap to its target
 * AWS tier? Coverage ring + per-requirement state + an "add the uncovered ones"
 * nudge that recomposes the missing tier-requirement milestones (draft only).
 */
function TierReadinessPanel({
  cov,
  tierLabel,
  isDraft,
  roadmapId,
  aiEnabled,
}: {
  cov: CoverageSummary;
  tierLabel: string;
  isDraft: boolean;
  roadmapId: string;
  aiEnabled: boolean;
}): ReactNode {
  return (
    <Panel title="Tier readiness" accent="var(--section-accent)">
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 140 }}>
          <RingGauge value={cov.percent} color={tierRingColor(cov.percent)} caption="covered" size={120} />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{tierLabel} tier</span>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <MetricStrip min={150}>
            <MetricCard label="Requirements" value={String(cov.total)} />
            <MetricCard
              label="Have a milestone"
              value={String(cov.withMilestone)}
              tone={cov.withMilestone === cov.total ? "ok" : "neutral"}
            />
            <MetricCard label="Done" value={String(cov.covered)} tone={cov.covered > 0 ? "ok" : "neutral"} />
            <MetricCard
              label="Tier-ready"
              value={cov.projectedReadyDate ?? "—"}
              sub={cov.projectedComplete ? "all covered" : "latest milestone target"}
            />
          </MetricStrip>
        </div>
      </div>

      <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
        {cov.requirements.map((r) => (
          <div
            key={r.key}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              fontSize: 13,
              paddingBottom: 6,
              borderBottom: "1px solid var(--border)",
            }}
          >
            <Badge tone={COVERAGE_TONE[r.state]}>{COVERAGE_LABEL[r.state]}</Badge>
            <span>{r.label}</span>
            {r.targetDate ? (
              <span style={{ color: "var(--muted)", marginLeft: "auto", fontSize: 12 }}>{r.targetDate}</span>
            ) : null}
          </div>
        ))}
      </div>

      {cov.uncovered > 0 && isDraft ? (
        <div style={{ marginTop: 12 }}>
          <Callout tone="warn" title={`${cov.uncovered} uncovered tier requirement${cov.uncovered === 1 ? "" : "s"}`}>
            <div style={{ display: "grid", gap: 8 }}>
              <span>
                These {tierLabel} requirements have no milestone yet. Add them to close the gap to the tier.
              </span>
              <div>
                <MutationForm
                  action={recomposeRoadmap}
                  submitLabel={`Add ${cov.uncovered} requirement${cov.uncovered === 1 ? "" : "s"}`}
                  variant="secondary"
                  hidden={{ roadmapId, targetTier: cov.tier }}
                />
              </div>
            </div>
          </Callout>
        </div>
      ) : null}

      <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <RoadmapNarrative enabled={aiEnabled} roadmapId={roadmapId} />
      </div>
    </Panel>
  );
}
