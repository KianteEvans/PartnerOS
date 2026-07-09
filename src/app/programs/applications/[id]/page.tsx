import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { env } from "@/env";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge, statusTone, type Tone } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { MutationForm } from "@/components/ui/MutationForm";
import { BulkProvider } from "@/components/ui/bulk/BulkProvider";
import { BulkBar } from "@/components/ui/bulk/BulkBar";
import { BulkCheckbox } from "@/components/ui/bulk/BulkCheckbox";
import { BulkActionForm } from "@/components/ui/bulk/BulkActionForm";
import { GenerateResponse } from "@/components/ui/GenerateResponse";
import { GenerateAllResponses } from "@/components/ui/GenerateAllResponses";
import { updateControl, bulkUpdateControls, markExported, updateApplication } from "@/domain/applications/actions";
import { loadApplicationDetail, loadAdoptedProgramOptions, type ControlRow } from "@/domain/applications/load";
import Link from "next/link";
import { loadCaseStudies } from "@/domain/case-studies/load";
import { attachCaseStudy, detachCaseStudy } from "@/domain/case-studies/actions";
import { loadSolutionOptions } from "@/domain/solutions/load";
import { evaluateEligibility, PROGRAM_PREREQUISITES } from "@/domain/applications/eligibility";
import { applicationReadiness, awsStatusLabel, AWS_STATUSES } from "@/domain/applications/packet";
import type { ProgramType } from "@/domain/applications/detect";
import { TIER_LABELS } from "@/domain/tiers/catalog";

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
const textareaStyle = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "inherit",
  resize: "vertical",
} as const;

function metTone(m: string): Tone {
  return m === "yes" ? "ok" : m === "partial" ? "warn" : m === "no" ? "danger" : "neutral";
}

function prereqTone(s: string): Tone {
  return s === "met" ? "ok" : s === "gap" ? "warn" : "info";
}

function awsStatusBadgeTone(s: string): Tone {
  if (s === "confirmed") return "ok";
  if (s === "declined" || s === "expired" || s === "deleted") return "danger";
  if (s === "pending_partner_action") return "warn";
  if (s === "draft") return "neutral";
  return "info";
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ControlCard({
  c,
  applicationId,
  aiEnabled,
}: {
  c: ControlRow;
  applicationId: string;
  aiEnabled: boolean;
}): ReactNode {
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <strong style={{ fontSize: 13.5 }}>{c.requirementText}</strong>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {c.controlId}
            {c.section ? ` · ${c.section}` : ""}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Badge tone={statusTone(c.status)}>{c.status}</Badge>
          {c.metSuggestion !== "unknown" && <Badge tone={metTone(c.metSuggestion)}>Met: {c.metSuggestion}</Badge>}
        </div>
      </div>

      {c.recommendedResponse && (
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 13,
            color: "var(--text)",
            whiteSpace: "pre-wrap",
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 10px",
          }}
        >
          {c.recommendedResponse.length > 280
            ? `${c.recommendedResponse.slice(0, 280)}…`
            : c.recommendedResponse}
        </p>
      )}

      {(c.aiConfidence > 0 || c.linkedTitles.length > 0) && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
          {c.aiConfidence > 0 ? `AI confidence ${c.aiConfidence}%` : ""}
          {c.linkedTitles.length > 0 ? ` · grounded on: ${c.linkedTitles.join(", ")}` : ""}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <FormDrawer
          triggerLabel={c.recommendedResponse ? "Review / edit" : "Write response"}
          triggerVariant="secondary"
          title={`${c.controlId} — Partner Response`}
          action={updateControl}
          submitLabel="Accept response"
          successMessage="Response accepted."
          hidden={{ controlId: c.id, applicationId }}
          width={640}
        >
          <div style={{ ...labelStyle }}>
            <span style={spanStyle}>Requirement</span>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text)" }}>{c.requirementText}</p>
          </div>
          {!c.canGenerate && (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
              This control expects multiple customer references; this field fills the first. Fill the
              others directly in the exported workbook.
            </p>
          )}
          <label style={labelStyle}>
            <span style={spanStyle}>Partner Response</span>
            <textarea name="response" rows={10} defaultValue={c.recommendedResponse} style={textareaStyle} />
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>Met?</span>
            <select name="met" defaultValue={c.metSuggestion} style={controlStyle}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="partial">Partial</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          {c.exampleResponse && (
            <details>
              <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>
                AWS example answer (style reference)
              </summary>
              <p style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "pre-wrap" }}>{c.exampleResponse}</p>
            </details>
          )}
        </FormDrawer>

        {c.canGenerate ? (
          <GenerateResponse controlId={c.id} enabled={aiEnabled} label={c.recommendedResponse ? "Re-generate" : "Generate response"} />
        ) : (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>Multiple customer references — fill manually</span>
        )}
      </div>
    </Card>
  );
}

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const aiEnabled = Boolean(env.ANTHROPIC_API_KEY);

  const data = await loadApplicationDetail(identity, id);
  if (!data) notFound();
  const { application, controls, currentTier, caseStudyCount, attachedCaseStudies } = data;
  const allCaseStudies = await loadCaseStudies(identity);
  const attachedIds = new Set(attachedCaseStudies.map((c) => c.id));
  const availableCaseStudies = allCaseStudies.filter((c) => !attachedIds.has(c.id));
  const solutionOptions = await loadSolutionOptions(identity);
  const programOptions = await loadAdoptedProgramOptions(identity);

  const programType = (application.programType || "Unknown") as ProgramType;
  const eligibility = evaluateEligibility(programType, currentTier);
  const showEligibility = (PROGRAM_PREREQUISITES[programType] ?? []).length > 0;
  const readiness = applicationReadiness({
    controlCount: application.controlCount,
    acceptedCount: application.acceptedCount,
    categories: application.categories,
    pocName: application.pocName,
    pocEmail: application.pocEmail,
    caseStudyCount,
    solutionAttached: application.solutionId !== null,
  });

  const bySheet = new Map<string, ControlRow[]>();
  for (const c of controls) {
    const arr = bySheet.get(c.sheetName) ?? [];
    arr.push(c);
    bySheet.set(c.sheetName, arr);
  }
  const generatableIds = controls.filter((c) => c.canGenerate && c.status !== "accepted").map((c) => c.id);
  const respondedPct =
    application.controlCount > 0 ? Math.round((application.acceptedCount / application.controlCount) * 100) : 0;
  const remaining = Math.max(0, application.controlCount - application.acceptedCount);

  return (
    <PageShell width={980}>
      <PageHeader
        breadcrumbs={[
          { href: "/", label: "Home" },
          { href: "/programs/applications", label: "Applications" },
          { label: application.name },
        ]}
        title={application.name}
        subtitle={
          <>
            {application.programType ? `${application.programType} · ` : ""}
            {application.competency || "Specialization"} · {application.status} ·{" "}
            <strong>{application.acceptedCount}</strong>/{application.controlCount} accepted ·{" "}
            {application.sourceFileName}
          </>
        }
      />

      <Panel title="Response progress" accent="var(--section-accent)">
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
            <span>{application.acceptedCount} of {application.controlCount} controls responded</span>
            <strong style={{ color: "var(--text)" }}>{respondedPct}%</strong>
          </div>
          <div style={{ height: 10, background: "var(--border)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${respondedPct}%`, height: "100%", background: respondedPct >= 100 ? "var(--ok)" : "var(--accent-2)", borderRadius: 999 }} />
          </div>
        </div>
        <MetricStrip min={130}>
          <MetricCard label="Controls" value={String(application.controlCount)} />
          <MetricCard label="Responded" value={String(application.acceptedCount)} tone={application.acceptedCount > 0 ? "ok" : "neutral"} />
          <MetricCard label="Remaining" value={String(remaining)} tone={remaining > 0 ? "warn" : "neutral"} />
          <MetricCard label="Sheets" value={String(bySheet.size)} />
        </MetricStrip>
      </Panel>

      <Panel
        title="Submission packet"
        accent="var(--section-accent)"
        actions={
          <FormDrawer
            triggerLabel="Edit packet"
            triggerVariant="secondary"
            title="Edit submission packet"
            action={updateApplication}
            submitLabel="Save"
            successMessage="Packet updated."
            hidden={{ applicationId: application.id }}
            width={520}
          >
            <label style={labelStyle}>
              <span style={spanStyle}>AWS application status</span>
              <select name="awsStatus" defaultValue={application.awsStatus} style={controlStyle}>
                {AWS_STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Designation categories</span>
              <input
                name="categories"
                defaultValue={application.categories}
                maxLength={500}
                placeholder="e.g. Threat Detection and Response"
                style={controlStyle}
              />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Point of contact - name</span>
              <input name="pocName" defaultValue={application.pocName} maxLength={200} style={controlStyle} />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Point of contact - email</span>
              <input name="pocEmail" type="email" defaultValue={application.pocEmail} maxLength={200} style={controlStyle} />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Point of contact - role</span>
              <input
                name="pocRole"
                defaultValue={application.pocRole}
                maxLength={100}
                placeholder="e.g. Alliance Lead"
                style={controlStyle}
              />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Validated Solution</span>
              <select name="solutionId" defaultValue={application.solutionId ?? ""} style={controlStyle}>
                <option value="">— None —</option>
                {solutionOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
              {solutionOptions.length === 0 && (
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  No Solutions yet — create one in the Solutions section.
                </span>
              )}
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Linked competency / program</span>
              <select name="programId" defaultValue={application.programId ?? ""} style={controlStyle}>
                <option value="">— None —</option>
                {programOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {programOptions.length === 0 && (
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  No adopted programs yet — pursue one in Program Management.
                </span>
              )}
            </label>
          </FormDrawer>
        }
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>AWS status</span>
          <Badge tone={awsStatusBadgeTone(application.awsStatus)}>{awsStatusLabel(application.awsStatus)}</Badge>
          {application.submittedAt && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Submitted {fmtDate(application.submittedAt)}</span>
          )}
          {application.confirmedAt && (
            <span style={{ fontSize: 12, color: "var(--ok)" }}>Confirmed {fmtDate(application.confirmedAt)}</span>
          )}
          {application.solutionTitle && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Solution:{" "}
              <Link
                href={`/programs/solutions/${application.solutionId}`}
                style={{ color: "var(--accent)", textDecoration: "none" }}
              >
                {application.solutionTitle}
              </Link>
            </span>
          )}
          {application.programName && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Program:{" "}
              <Link
                href={`/programs/${application.programId}`}
                style={{ color: "var(--accent)", textDecoration: "none" }}
              >
                {application.programName}
              </Link>
            </span>
          )}
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {readiness.items.map((it) => (
            <li
              key={it.label}
              style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ fontSize: 13 }}>{it.label}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{it.detail}</span>
              </div>
              <Badge tone={prereqTone(it.state)}>{it.state}</Badge>
            </li>
          ))}
        </ul>
      </Panel>

      {showEligibility && (
        <Panel title="Eligibility" accent="var(--section-accent)">
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--muted)" }}>
            AWS prerequisites for a {application.programType} application — your workspace tier is{" "}
            <strong style={{ color: "var(--text)" }}>{TIER_LABELS[currentTier]}</strong>. Path stage and FTR
            aren&apos;t tracked here; confirm them in AWS Partner Central.
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {eligibility.prerequisites.map((p) => (
              <li
                key={p.label}
                style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}
              >
                <div style={{ display: "grid", gap: 2 }}>
                  <span style={{ fontSize: 13 }}>{p.label}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.detail}</span>
                </div>
                <Badge tone={prereqTone(p.state)}>{p.state}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title={`Case studies (${attachedCaseStudies.length})`}
        accent="var(--section-accent)"
        actions={
          availableCaseStudies.length > 0 ? (
            <FormDrawer
              triggerLabel="Attach case study"
              triggerVariant="secondary"
              title="Attach a case study"
              action={attachCaseStudy}
              submitLabel="Attach"
              successMessage="Case study attached."
              hidden={{ applicationId: application.id }}
            >
              <label style={labelStyle}>
                <span style={spanStyle}>Case study</span>
                <select name="caseStudyId" required style={controlStyle}>
                  {availableCaseStudies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                      {c.customerName ? ` - ${c.customerName}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </FormDrawer>
          ) : (
            <Link href="/programs/evidence/case-studies" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13 }}>
              Create case studies →
            </Link>
          )
        }
      >
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--muted)" }}>
          Attached case studies fill the &quot;Customer Reference #N&quot; columns on the customer-example
          sheets when you export — in this order.
        </p>
        {attachedCaseStudies.length === 0 ? (
          <EmptyState title="No case studies attached" hint="Attach a case study to fill the Customer Reference columns when you export." />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {attachedCaseStudies.map((c, i) => (
              <li
                key={c.id}
                style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}
              >
                <span style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Badge>Reference #{i + 1}</Badge>
                  <Link href={`/programs/evidence/case-studies/${c.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
                    {c.title}
                  </Link>
                  {c.customerName ? <span style={{ color: "var(--muted)" }}>· {c.customerName}</span> : null}
                </span>
                <MutationForm
                  action={detachCaseStudy}
                  submitLabel="Remove"
                  variant="secondary"
                  hidden={{ applicationId: application.id, caseStudyId: c.id }}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Generate & export" accent="var(--section-accent)">
        <div style={{ display: "grid", gap: 12 }}>
          <GenerateAllResponses controlIds={generatableIds} enabled={aiEnabled} />
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <a
              href={`/programs/applications/${application.id}/export`}
              style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600, fontSize: 13 }}
            >
              Export filled workbook ↓
            </a>
            <MutationForm
              action={markExported}
              submitLabel="Mark exported"
              variant="secondary"
              hidden={{ applicationId: application.id }}
            />
          </div>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
            Responses are drafted from your Evidence Locker — review and accept each before exporting.
            The filled workbook preserves the original&apos;s Met? dropdowns and formatting.
          </p>
        </div>
      </Panel>

      {controls.length > 0 && (
        <BulkProvider allIds={controls.map((c) => c.id)}>
          {[...bySheet.entries()].map(([sheet, items]) => {
            const acc = items.filter((c) => c.status === "accepted").length;
            return (
              <Panel key={sheet} title={`${sheet} — ${acc}/${items.length} responded`} accent="var(--section-accent)">
                <div style={{ display: "grid", gap: 12 }}>
                  {items.map((c) => (
                    <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <BulkCheckbox id={c.id} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <ControlCard c={c} applicationId={application.id} aiEnabled={aiEnabled} />
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            );
          })}
          <BulkBar>
            <BulkActionForm
              action={bulkUpdateControls}
              field="status"
              options={[
                { value: "accepted", label: "Mark accepted" },
                { value: "open", label: "Mark open" },
              ]}
              hidden={{ applicationId: application.id }}
              submitLabel="Set status"
              successMessage="Controls updated."
            />
            <BulkActionForm
              action={bulkUpdateControls}
              field="met"
              options={[
                { value: "yes", label: "Met: Yes" },
                { value: "no", label: "Met: No" },
                { value: "partial", label: "Met: Partial" },
                { value: "unknown", label: "Met: Unknown" },
              ]}
              hidden={{ applicationId: application.id }}
              submitLabel="Set Met?"
              successMessage="Met updated."
            />
          </BulkBar>
        </BulkProvider>
      )}

      {controls.length === 0 && (
        <Panel>
          <EmptyState title="No controls detected" hint="No controls were detected in this workbook." />
        </Panel>
      )}
    </PageShell>
  );
}
