import type { ReactNode } from "react";
import Link from "next/link";
import { and, eq, asc, desc, lt } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import {
  assessments,
  assessmentModules,
  assessmentResponses,
  assessmentRecommendations,
  tenants,
} from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { MutationForm } from "@/components/ui/MutationForm";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { RingGauge } from "@/components/ui/RingGauge";
import { ChipList } from "@/components/ui/ChipList";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconAssessments } from "@/components/ui/icons";
import { MetricCard, type MetricTrend } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { DeltaChip } from "@/components/ui/DeltaChip";
import {
  submitAssessment,
  saveResponses,
  approveRecommendation,
  approveAllRecommendations,
  rejectRecommendation,
} from "@/domain/assessments/actions";
import {
  ALL_MODULES,
  MODULE_LABELS,
  PRESET_LABELS,
  PRESET_MODULES,
  questionsForModule,
  type ModuleId,
  type PresetId,
} from "@/domain/assessments/catalog";
import {
  GAP_THRESHOLD,
  STRENGTH_THRESHOLD,
  type ScoredModule,
} from "@/domain/assessments/scoring";
import {
  overallBand,
  moduleBand,
  weakestQuestions,
  moduleDeltas,
  deltaOf,
  type OverallBand,
} from "@/domain/assessments/insights";
import { PROGRAM_LIBRARY } from "@/domain/programs/library";
import {
  TIER_LABELS,
  tiersAbove,
  thresholdsForTier,
  type TierId,
} from "@/domain/tiers/catalog";

const REC_TYPE_LABELS: Record<string, string> = {
  program: "Program",
  evidence_gap: "Evidence gap",
  task: "Task",
  milestone: "Milestone",
};

const BAND_COLOR: Record<OverallBand, string> = {
  strong: "var(--ok)",
  fair: "var(--warn)",
  at_risk: "var(--danger)",
};
const BAND_TONE: Record<OverallBand, "ok" | "warn" | "danger"> = {
  strong: "ok",
  fair: "warn",
  at_risk: "danger",
};
const moduleColor = (score: number): string => {
  const b = moduleBand(score);
  return b === "strength" ? "var(--ok)" : b === "gap" ? "var(--danger)" : "var(--warn)";
};
const moduleTone = (score: number): "ok" | "warn" | "danger" => {
  const b = moduleBand(score);
  return b === "strength" ? "ok" : b === "gap" ? "danger" : "warn";
};

export default async function AssessmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");

  const data = await withTenant(identity, async (tx) => {
    const [assessment] = await tx
      .select()
      .from(assessments)
      .where(
        and(eq(assessments.id, id), eq(assessments.tenantId, identity.tenantId)),
      );
    if (!assessment) return null;

    const moduleRows = await tx
      .select({ module: assessmentModules.module, score: assessmentModules.score })
      .from(assessmentModules)
      .where(
        and(
          eq(assessmentModules.assessmentId, id),
          eq(assessmentModules.tenantId, identity.tenantId),
        ),
      );

    const responseRows = await tx
      .select({
        questionKey: assessmentResponses.questionKey,
        value: assessmentResponses.value,
      })
      .from(assessmentResponses)
      .where(
        and(
          eq(assessmentResponses.assessmentId, id),
          eq(assessmentResponses.tenantId, identity.tenantId),
        ),
      );

    const recs = await tx
      .select()
      .from(assessmentRecommendations)
      .where(
        and(
          eq(assessmentRecommendations.assessmentId, id),
          eq(assessmentRecommendations.tenantId, identity.tenantId),
        ),
      )
      .orderBy(asc(assessmentRecommendations.createdAt));

    const [t] = await tx
      .select({ tier: tenants.tier })
      .from(tenants)
      .where(eq(tenants.id, identity.tenantId));

    // The immediately-prior scored assessment of the SAME preset, for deltas.
    let priorModules: { module: string; score: number | null }[] = [];
    let priorOverall: number | null = null;
    if (assessment.status === "scored" && assessment.submittedAt) {
      const [prior] = await tx
        .select({ id: assessments.id, overallScore: assessments.overallScore })
        .from(assessments)
        .where(
          and(
            eq(assessments.tenantId, identity.tenantId),
            eq(assessments.preset, assessment.preset),
            eq(assessments.status, "scored"),
            lt(assessments.submittedAt, assessment.submittedAt),
          ),
        )
        .orderBy(desc(assessments.submittedAt))
        .limit(1);
      if (prior) {
        priorOverall = prior.overallScore;
        priorModules = await tx
          .select({ module: assessmentModules.module, score: assessmentModules.score })
          .from(assessmentModules)
          .where(
            and(
              eq(assessmentModules.assessmentId, prior.id),
              eq(assessmentModules.tenantId, identity.tenantId),
            ),
          );
      }
    }

    return {
      assessment,
      moduleRows,
      responseRows,
      recs,
      currentTier: (t?.tier ?? "registered") as TierId,
      priorModules,
      priorOverall,
    };
  });

  if (!data) notFound();
  const { assessment, moduleRows, responseRows, recs, currentTier, priorModules, priorOverall } = data;
  const preset = assessment.preset as PresetId;

  // Modules in catalog order.
  const scopeOrder = (a: ModuleId, b: ModuleId) =>
    ALL_MODULES.indexOf(a) - ALL_MODULES.indexOf(b);
  const modules = moduleRows.map((m) => m.module as ModuleId).sort(scopeOrder);
  const scoreByModule = new Map(
    moduleRows.map((m) => [m.module as ModuleId, m.score ?? 0]),
  );
  const savedValues = new Map(
    responseRows.map((r) => [
      r.questionKey,
      typeof r.value === "string" ? r.value : String(r.value),
    ]),
  );

  return (
    <PageShell width={900}>
      <PageHeader
        breadcrumbs={[{ href: "/", label: "Home" }, { href: "/plan", label: "Assessments" }, { label: assessment.name }]}
        title={assessment.name}
        subtitle={
          <>
            {PRESET_LABELS[preset]}
            {assessment.targetProgram ? ` · Target: ${assessment.targetProgram}` : ""}
            {assessment.status === "scored" && assessment.overallScore !== null
              ? ` · Overall ${assessment.overallScore}/100`
              : " · Draft"}
          </>
        }
      />

      {assessment.status === "draft" ? (
        <>
          <Panel title="Answer the questions" accent="var(--section-accent)" icon={<IconAssessments size={16} />}>
            <MutationForm
              action={saveResponses}
              submitLabel="Save answers"
              hidden={{ assessmentId: assessment.id }}
            >
              <div style={{ display: "grid", gap: 24 }}>
                {modules.map((module) => (
                  <ModuleQuestions
                    key={module}
                    module={module}
                    savedValues={savedValues}
                  />
                ))}
              </div>
            </MutationForm>
          </Panel>

          <Panel title="Submit for scoring" accent="var(--section-accent)" icon={<IconAssessments size={16} />}>
            <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
              Submitting scores every in-scope module, generates approval-gated
              recommendations, and locks the assessment. Save your answers first.
            </p>
            <MutationForm
              action={submitAssessment}
              submitLabel="Submit & score"
              hidden={{ assessmentId: assessment.id }}
            />
          </Panel>
        </>
      ) : (
        <ScoredResults
          assessmentId={assessment.id}
          preset={preset}
          targetProgram={assessment.targetProgram}
          overall={assessment.overallScore ?? 0}
          modules={modules}
          scoreByModule={scoreByModule}
          savedValues={savedValues}
          recs={recs}
          currentTier={currentTier}
          priorModules={priorModules}
          priorOverall={priorOverall}
        />
      )}
    </PageShell>
  );
}

interface RecRow {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly detail: string;
  readonly confidence: number;
  readonly status: string;
}

/** The scored-results view: health hero, per-module bars, gaps diagnostic, grounding, recs. */
function ScoredResults({
  assessmentId,
  preset,
  targetProgram,
  overall,
  modules,
  scoreByModule,
  savedValues,
  recs,
  currentTier,
  priorModules,
  priorOverall,
}: {
  assessmentId: string;
  preset: PresetId;
  targetProgram: string | null;
  overall: number;
  modules: readonly ModuleId[];
  scoreByModule: ReadonlyMap<ModuleId, number>;
  savedValues: ReadonlyMap<string, string>;
  recs: readonly RecRow[];
  currentTier: TierId;
  priorModules: readonly { module: string; score: number | null }[];
  priorOverall: number | null;
}): ReactNode {
  const band = overallBand(overall);
  const overallDelta = deltaOf(overall, priorOverall);
  const overallTrend: MetricTrend | undefined =
    priorOverall !== null && overallDelta !== null
      ? { values: [priorOverall, overall], delta: overallDelta }
      : undefined;

  const scored: ScoredModule[] = modules.map((m) => ({ module: m, score: scoreByModule.get(m) ?? 0 }));
  const priorScored: ScoredModule[] | null =
    priorModules.length > 0
      ? priorModules.map((m) => ({ module: m.module as ModuleId, score: m.score ?? 0 }))
      : null;
  const deltaByModule = new Map(moduleDeltas(scored, priorScored).map((d) => [d.module, d.delta]));

  const strengths = scored.filter((m) => m.score >= STRENGTH_THRESHOLD).map((m) => m.module);
  const gaps = scored.filter((m) => m.score < GAP_THRESHOLD).sort((a, b) => a.score - b.score);
  const pendingCount = recs.filter((r) => r.status === "pending").length;

  const grounding = groundingFor(preset, targetProgram, currentTier);
  const groundingModules = PRESET_MODULES[preset];

  return (
    <>
      <section
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          alignItems: "center",
          background: "var(--surface-hero)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 20,
          boxShadow: "var(--shadow-md)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 150 }}>
          <RingGauge value={overall} color={BAND_COLOR[band]} caption="overall" size={120} />
          <Badge tone={BAND_TONE[band]}>{band.replace("_", " ")}</Badge>
        </div>
        <div style={{ flex: 1, minWidth: 260, display: "grid", gap: 12 }}>
          <MetricStrip min={130}>
            <MetricCard label="Overall" value={`${overall}/100`} trend={overallTrend} />
            <MetricCard label="Strengths" value={String(strengths.length)} tone={strengths.length > 0 ? "ok" : "neutral"} />
            <MetricCard label="Gaps" value={String(gaps.length)} tone={gaps.length > 0 ? "danger" : "neutral"} />
            <MetricCard label="Recommendations" value={String(recs.length)} sub={pendingCount > 0 ? `${pendingCount} pending` : "all reviewed"} />
          </MetricStrip>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Link
              href={`/plan/roadmaps/new?fromAssessment=${assessmentId}`}
              style={{ background: "var(--accent)", color: "var(--accent-ink)", border: "none", padding: "8px 14px", borderRadius: 8, fontWeight: 600, fontSize: 13, textDecoration: "none" }}
            >
              {gaps.length > 0 ? `Build roadmap from ${gaps.length} gap${gaps.length === 1 ? "" : "s"} →` : "Build roadmap →"}
            </Link>
            {priorOverall === null && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>First assessment of this type — re-run later to track progress.</span>
            )}
          </div>
        </div>
      </section>

      <Panel title="Module scores" accent="var(--section-accent)">
        <div style={{ display: "grid", gap: 10 }}>
          {scored.map((m) => (
            <ModuleRow
              key={m.module}
              label={MODULE_LABELS[m.module]}
              score={m.score}
              delta={deltaByModule.get(m.module) ?? null}
            />
          ))}
        </div>
        {priorOverall !== null && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--muted)" }}>
            ▲/▼ vs your previous {PRESET_LABELS[preset]} assessment.
          </p>
        )}
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <Panel title={`Strengths (${strengths.length})`} accent="var(--section-accent)">
          <ChipList
            items={strengths.map((m) => ({
              key: m,
              label: MODULE_LABELS[m],
              badges: <Badge tone="ok">{scoreByModule.get(m)}/100</Badge>,
            }))}
            empty={<p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>No modules at {STRENGTH_THRESHOLD}+ yet.</p>}
          />
        </Panel>

        <Panel title={`Gaps (${gaps.length})`} accent="var(--section-accent)">
          {gaps.length === 0 ? (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>No gaps — every module is at {GAP_THRESHOLD}+.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {gaps.map((g) => (
                <Card key={g.module} compact style={{ borderLeft: "3px solid var(--danger)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 13 }}>{MODULE_LABELS[g.module]}</strong>
                    <Badge tone="danger">{g.score}/100</Badge>
                  </div>
                  <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
                    {weakestQuestions(g.module, savedValues).map((w) => (
                      <li key={w.key} style={{ fontSize: 12, color: "var(--muted)" }}>
                        <span style={{ color: "var(--text)" }}>{w.prompt}</span>
                        <br />
                        {w.answerLabel} · {w.score}/100
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {grounding && (
        <Panel title="What this maps to" accent="var(--section-accent)" icon={<IconAssessments size={16} />}>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--muted)" }}>{grounding.heading}:</p>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, fontSize: 13 }}>
            {grounding.items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {groundingModules.map((m) =>
              scoreByModule.has(m) ? (
                <Badge key={m} tone={moduleTone(scoreByModule.get(m) ?? 0)}>
                  {MODULE_LABELS[m]} {scoreByModule.get(m)}/100
                </Badge>
              ) : null,
            )}
          </div>
        </Panel>
      )}

      <Panel
        title={`Recommendations (${recs.length})`}
        accent="var(--section-accent)"
        actions={
          pendingCount > 0 ? (
            <MutationForm
              action={approveAllRecommendations}
              submitLabel={`Approve all (${pendingCount})`}
              successMessage="Approved — Tasks created in Task Manager."
              hidden={{ assessmentId }}
            />
          ) : undefined
        }
      >
        {recs.length === 0 ? (
          <EmptyState title="No recommendations" hint="None were generated for this assessment." />
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {recs.map((rec) => (
              <Card key={rec.id} compact>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <strong style={{ fontSize: 14 }}>{rec.title}</strong>
                  <span style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>
                    {REC_TYPE_LABELS[rec.type] ?? rec.type} · {rec.confidence}%
                  </span>
                </div>
                <div style={{ height: 4, background: "var(--border)", borderRadius: 999, overflow: "hidden", margin: "6px 0 8px" }}>
                  <div style={{ width: `${Math.max(0, Math.min(100, rec.confidence))}%`, height: "100%", background: "var(--accent-2)" }} />
                </div>
                <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 10px" }}>{rec.detail}</p>
                {rec.status === "pending" ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <MutationForm
                      action={approveRecommendation}
                      submitLabel="Approve"
                      successMessage={
                        rec.type === "evidence_gap"
                          ? "Approved → created a Task and an Evidence record."
                          : "Approved → created a Task in Task Manager."
                      }
                      hidden={{ recommendationId: rec.id, assessmentId }}
                    />
                    <MutationForm action={rejectRecommendation} submitLabel="Reject" variant="secondary" hidden={{ recommendationId: rec.id, assessmentId }} />
                  </div>
                ) : rec.status === "approved" ? (
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    <span style={{ color: "var(--accent)" }}>Approved</span>
                    <span style={{ color: "var(--muted)" }}> → </span>
                    <Link href="/command/tasks" style={{ color: "var(--accent)" }}>Task Manager</Link>
                    {rec.type === "evidence_gap" && (
                      <>
                        <span style={{ color: "var(--muted)" }}> & </span>
                        <Link href="/programs/evidence" style={{ color: "var(--accent)" }}>Evidence Locker</Link>
                      </>
                    )}
                  </span>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Rejected</span>
                )}
              </Card>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

/** A per-module score row: label + threshold-colored bar + score + optional ▲/▼ delta. */
function ModuleRow({
  label,
  score,
  delta,
}: {
  label: string;
  score: number;
  delta: number | null;
}): ReactNode {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 190px) 1fr auto auto", gap: 12, alignItems: "center", fontSize: 13 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <div style={{ height: 8, background: "var(--border)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(0, Math.min(100, score))}%`, height: "100%", background: moduleColor(score), borderRadius: 999 }} />
      </div>
      <strong style={{ fontVariantNumeric: "tabular-nums", minWidth: 46, textAlign: "right" }}>{score}/100</strong>
      {delta !== null ? <DeltaChip delta={delta} /> : <span />}
    </div>
  );
}

/** What the assessment's score is a proxy for: the real AWS requirement bar for its goal. */
function groundingFor(
  preset: PresetId,
  targetProgram: string | null,
  currentTier: TierId,
): { heading: string; items: string[] } | null {
  if (preset === "program_submission" && targetProgram) {
    const tp = targetProgram.trim().toLowerCase();
    const prog =
      PROGRAM_LIBRARY.find((p) => p.name.toLowerCase() === tp) ??
      PROGRAM_LIBRARY.find((p) => p.name.toLowerCase().includes(tp) || tp.includes(p.name.toLowerCase()));
    if (prog) {
      return { heading: `${prog.name} requires`, items: prog.requirements.map((r) => r.label) };
    }
    return null;
  }
  if (preset === "tier_advancement") {
    const next = tiersAbove(currentTier)[0];
    if (next) {
      return {
        heading: `${TIER_LABELS[next]} tier requires`,
        items: thresholdsForTier(next).map((t) => `${t.label} — ${t.threshold} ${t.unit}`),
      };
    }
  }
  return null;
}

/** Server-rendered radio groups for one module, prefilled from saved answers. */
function ModuleQuestions({
  module,
  savedValues,
}: {
  module: ModuleId;
  savedValues: ReadonlyMap<string, string>;
}): ReactNode {
  return (
    <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
      <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
        {MODULE_LABELS[module]}
      </legend>
      <div style={{ display: "grid", gap: 14 }}>
        {questionsForModule(module).map((q) => {
          const saved = savedValues.get(q.key);
          return (
            <div key={q.key}>
              <p style={{ margin: "0 0 6px", fontSize: 13 }}>{q.prompt}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {q.options.map((o) => (
                  <label
                    key={o.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      color: "var(--muted)",
                    }}
                  >
                    <input
                      type="radio"
                      name={q.key}
                      value={o.value}
                      defaultChecked={saved === o.value}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
