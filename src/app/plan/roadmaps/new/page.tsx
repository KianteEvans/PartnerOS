import type { ReactNode } from "react";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { assessments, users, tenants } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { MutationForm } from "@/components/ui/MutationForm";
import { createRoadmap } from "@/domain/roadmaps/actions";
import {
  HORIZON_LABELS,
  SCENARIO_LABELS,
  type HorizonId,
  type ScenarioId,
} from "@/domain/roadmaps/planner";
import { PROGRAM_LIBRARY } from "@/domain/programs/library";
import {
  TIER_LABELS,
  tiersAbove,
  thresholdsForTier,
  type TierId,
} from "@/domain/tiers/catalog";
import { RoadmapComposer } from "@/app/plan/roadmaps/RoadmapComposer";

const labelStyle = { display: "grid", gap: 4, fontSize: 13 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
} as const;

const HORIZONS = Object.keys(HORIZON_LABELS) as HorizonId[];
const SCENARIOS = Object.keys(SCENARIO_LABELS) as ScenarioId[];

export default async function NewRoadmapPage({
  searchParams,
}: {
  searchParams: Promise<{ fromAssessment?: string }>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");

  const { fromAssessment } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  // Assessment-seeded path: keep the simple form that builds milestones from an
  // assessment's recommendations.
  if (fromAssessment) {
    const [a] = await withTenant(identity, (tx) =>
      tx
        .select({ name: assessments.name })
        .from(assessments)
        .where(
          and(
            eq(assessments.id, fromAssessment),
            eq(assessments.tenantId, identity.tenantId),
          ),
        ),
    );
    if (a) {
      return (
        <PageShell width={640}>
          <PageHeader
            back={{ href: "/plan/roadmaps", label: "Roadmaps" }}
            title="New roadmap"
          />
          <Panel>
            <p
              style={{
                fontSize: 13,
                background: "rgba(255,153,0,0.08)",
                border: "1px solid var(--accent)",
                borderRadius: 8,
                padding: "8px 12px",
                marginTop: 0,
              }}
            >
              Seeding milestones from assessment recommendations:{" "}
              <strong>{a.name}</strong>
            </p>
            <MutationForm action={createRoadmap} submitLabel="Create roadmap">
              <input
                type="hidden"
                name="sourceAssessmentId"
                value={fromAssessment}
              />
              <label style={labelStyle}>
                <span style={spanStyle}>Name</span>
                <input
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={`${a.name} — Roadmap`}
                  style={controlStyle}
                />
              </label>
              <label style={labelStyle}>
                <span style={spanStyle}>Objective</span>
                <input
                  name="objective"
                  maxLength={500}
                  placeholder="e.g. Reach Advanced tier and launch in Marketplace"
                  style={controlStyle}
                />
              </label>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label style={labelStyle}>
                  <span style={spanStyle}>Horizon</span>
                  <select name="horizon" defaultValue="m6" style={controlStyle}>
                    {HORIZONS.map((h) => (
                      <option key={h} value={h}>
                        {HORIZON_LABELS[h]}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle}>
                  <span style={spanStyle}>Scenario</span>
                  <select name="scenario" defaultValue="standard" style={controlStyle}>
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
                    defaultValue={today}
                    required
                    style={controlStyle}
                  />
                </label>
              </div>
            </MutationForm>
          </Panel>
        </PageShell>
      );
    }
    // Unknown/foreign assessment id -> fall through to the composer.
  }

  // Composer path: assemble a roadmap from selected programs + a target tier.
  const { members, currentTier } = await withTenant(identity, async (tx) => {
    const members = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.tenantId, identity.tenantId));
    const [t] = await tx
      .select({ tier: tenants.tier })
      .from(tenants)
      .where(eq(tenants.id, identity.tenantId));
    return { members, currentTier: (t?.tier ?? "registered") as TierId };
  });

  const programs = PROGRAM_LIBRARY.map((p) => ({
    key: p.key,
    name: p.name,
    programType: p.programType,
    deliveryModel: p.deliveryModel,
    fundingFit: p.fundingFit,
    requirementCount: p.requirements.length,
  }));
  const tiers = tiersAbove(currentTier).map((id) => ({
    id,
    label: TIER_LABELS[id],
    thresholdCount: thresholdsForTier(id).length,
  }));

  return (
    <PageShell width={980}>
      <PageHeader
        back={{ href: "/plan/roadmaps", label: "Roadmaps" }}
        title="Build a roadmap"
        subtitle="Compose a plan from the AWS programs and tier advancement you want to pursue — then assign an owner to each milestone."
      />
      <Panel>
        <RoadmapComposer
          programs={programs}
          tiers={tiers}
          currentTierLabel={TIER_LABELS[currentTier]}
          members={members}
          today={today}
        />
      </Panel>
    </PageShell>
  );
}
