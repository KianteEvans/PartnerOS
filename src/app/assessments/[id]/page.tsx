import type { ReactNode } from "react";
import Link from "next/link";
import { and, eq, asc } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import {
  assessments,
  assessmentModules,
  assessmentResponses,
  assessmentRecommendations,
} from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { MutationForm } from "@/components/ui/MutationForm";
import {
  submitAssessment,
  saveResponses,
  approveRecommendation,
  rejectRecommendation,
} from "@/domain/assessments/actions";
import {
  ALL_MODULES,
  MODULE_LABELS,
  PRESET_LABELS,
  questionsForModule,
  type ModuleId,
  type PresetId,
} from "@/domain/assessments/catalog";
import { GAP_THRESHOLD, STRENGTH_THRESHOLD } from "@/domain/assessments/scoring";

const REC_TYPE_LABELS: Record<string, string> = {
  program: "Program",
  evidence_gap: "Evidence gap",
  task: "Task",
  milestone: "Milestone",
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
        and(
          eq(assessments.id, id),
          eq(assessments.tenantId, identity.tenantId),
        ),
      );
    if (!assessment) return null;

    const moduleRows = await tx
      .select({
        module: assessmentModules.module,
        score: assessmentModules.score,
      })
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

    return { assessment, moduleRows, responseRows, recs };
  });

  if (!data) notFound();
  const { assessment, moduleRows, responseRows, recs } = data;

  // Modules in catalog order.
  const scopeOrder = (a: ModuleId, b: ModuleId) =>
    ALL_MODULES.indexOf(a) - ALL_MODULES.indexOf(b);
  const modules = moduleRows
    .map((m) => m.module as ModuleId)
    .sort(scopeOrder);
  const scoreByModule = new Map(
    moduleRows.map((m) => [m.module as ModuleId, m.score]),
  );
  const savedValues = new Map(
    responseRows.map((r) => [
      r.questionKey,
      typeof r.value === "string" ? r.value : String(r.value),
    ]),
  );

  return (
    <PageShell width={820}>
      <PageHeader
        breadcrumbs={[{ href: "/", label: "Home" }, { href: "/assessments", label: "Assessments" }, { label: assessment.name }]}
        title={assessment.name}
        subtitle={
          <>
            {PRESET_LABELS[assessment.preset as PresetId]}
            {assessment.targetProgram ? ` · Target: ${assessment.targetProgram}` : ""}
            {assessment.status === "scored" && assessment.overallScore !== null
              ? ` · Overall ${assessment.overallScore}/100`
              : " · Draft"}
          </>
        }
      />

      {assessment.status === "draft" ? (
        <>
          <Panel title="Answer the questions">
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

          <Panel title="Submit for scoring">
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
        <>
          <Panel title="Module scores">
            <div style={{ display: "grid", gap: 8 }}>
              {modules.map((module) => {
                const score = scoreByModule.get(module) ?? 0;
                const band =
                  score >= STRENGTH_THRESHOLD
                    ? "Strength"
                    : score < GAP_THRESHOLD
                      ? "Gap"
                      : "On track";
                return (
                  <div
                    key={module}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      borderBottom: "1px solid var(--border)",
                      paddingBottom: 6,
                    }}
                  >
                    <span>{MODULE_LABELS[module]}</span>
                    <span style={{ color: "var(--muted)" }}>
                      {score}/100 · {band}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel
            title={`Recommendations (${recs.length})`}
            actions={
              recs.length > 0 ? (
                <Link
                  href={`/roadmaps/new?fromAssessment=${assessment.id}`}
                  style={{
                    background: "transparent",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 13,
                    textDecoration: "none",
                  }}
                >
                  Build roadmap →
                </Link>
              ) : undefined
            }
          >
            {recs.length === 0 ? (
              <p style={{ color: "var(--muted)", margin: 0 }}>
                No recommendations were generated.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                {recs.map((rec) => (
                  <div
                    key={rec.id}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <strong style={{ fontSize: 14 }}>{rec.title}</strong>
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>
                        {REC_TYPE_LABELS[rec.type] ?? rec.type} · {rec.confidence}%
                      </span>
                    </div>
                    <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 10px" }}>
                      {rec.detail}
                    </p>
                    {rec.status === "pending" ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <MutationForm
                          action={approveRecommendation}
                          submitLabel="Approve"
                          hidden={{
                            recommendationId: rec.id,
                            assessmentId: assessment.id,
                          }}
                        />
                        <MutationForm
                          action={rejectRecommendation}
                          submitLabel="Reject"
                          variant="secondary"
                          hidden={{
                            recommendationId: rec.id,
                            assessmentId: assessment.id,
                          }}
                        />
                      </div>
                    ) : rec.status === "approved" ? (
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        <span style={{ color: "var(--accent)" }}>Approved</span>
                        <span style={{ color: "var(--muted)" }}> → </span>
                        <Link href="/tasks" style={{ color: "var(--accent)" }}>
                          Task Manager
                        </Link>
                        {rec.type === "evidence_gap" && (
                          <>
                            <span style={{ color: "var(--muted)" }}> & </span>
                            <Link href="/evidence" style={{ color: "var(--accent)" }}>
                              Evidence Locker
                            </Link>
                          </>
                        )}
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--muted)",
                        }}
                      >
                        Rejected
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </PageShell>
  );
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
