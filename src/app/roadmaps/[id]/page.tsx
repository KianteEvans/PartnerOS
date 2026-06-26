import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { roadmaps, roadmapMilestones, users, programs, tierRequirements, tenants } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { statusTone, type Tone } from "@/components/ui/Badge";
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
import { TIER_LABELS, tiersAbove, type TierId } from "@/domain/tiers/catalog";

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
import { MilestoneViews } from "@/app/roadmaps/MilestoneViews";
import { RoadmapProgressHeader } from "@/app/roadmaps/RoadmapProgressHeader";
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
    };
  });

  if (!data) notFound();
  const { roadmap, milestones, members, adoptedPrograms, tierReqs, currentTier } =
    data;
  const isDraft = roadmap.status === "draft";
  const tierOptions = tiersAbove(currentTier).map((tid) => ({
    id: tid,
    label: TIER_LABELS[tid],
  }));
  const today = new Date().toISOString().slice(0, 10);
  const prog = roadmapProgress(milestones, today);

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
          href: "/tiers",
        };
      }
    }
  }

  return (
    <PageShell width={860}>
      <PageHeader
        breadcrumbs={[
          { href: "/", label: "Home" },
          { href: "/roadmaps", label: "Roadmaps" },
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

      {roadmap.objective && (
        <p style={{ fontSize: 14, margin: 0 }}>{roadmap.objective}</p>
      )}

      {milestones.length > 0 && (
        <Panel title="Progress">
          <RoadmapProgressHeader progress={prog} />
        </Panel>
      )}

      <Panel title="Share & iterate">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <a href={`/roadmaps/${roadmap.id}/export`} style={secBtnStyle}>
            Export CSV
          </a>
          <a
            href={`/roadmaps/${roadmap.id}/print`}
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
        <Panel title="Finalized">
          <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>
            The structure is locked — keep the plan alive by updating each
            milestone&apos;s status. Each milestone was handed off as a task.{" "}
            <Link href="/tasks" style={{ color: "var(--accent)" }}>
              View tasks →
            </Link>
          </p>
        </Panel>
      )}

      <Panel title={`Milestones (${milestones.length})`}>
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
        <Panel title="Grow from catalog">
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
            <fieldset
              style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}
            >
              <legend style={{ fontSize: 12, color: "var(--muted)", padding: 0 }}>
                Programs &amp; competencies
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
        <Panel title="Finalize">
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
