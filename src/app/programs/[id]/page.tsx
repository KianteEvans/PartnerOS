import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, eq, ne } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { programs, programRequirements, evidence, solutions, tasks, users } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Table, type Column } from "@/components/ui/Table";
import { BarChart } from "@/components/ui/BarChart";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { ChipList } from "@/components/ui/ChipList";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconApplications, IconPrograms, IconSolutions } from "@/components/ui/icons";
import { MutationForm } from "@/components/ui/MutationForm";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { EvaluateEvidence } from "@/components/ui/EvaluateEvidence";
import { env } from "@/env";
import { loadProgramRoiDetail, type RoiOppRow } from "@/domain/programs/roi-load";
import { loadApplicationsForProgram } from "@/domain/applications/load";
import { awsStatusLabel } from "@/domain/applications/packet";
import { AWS_ORG_TITLE_LABELS, type RepRollup } from "@/domain/ace/sales-org";
import { availabilityLabel } from "@/domain/solutions/labels";
import { STAGE_LABELS } from "@/domain/ace/opportunities";
import {
  updateProgram,
  updateRequirement,
  createRequirementTask,
  stageRequirementEvidence,
  linkRequirementEvidence,
  submitProgram,
} from "@/domain/programs/actions";
import {
  computeReadinessGate,
  requirementProgress,
  GATE_LABELS,
  type RequirementState,
  type ProgramStatusValue,
} from "@/domain/programs/gate";
import { money } from "@/domain/format";

const labelStyle = { display: "grid", gap: 4, fontSize: 12 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const stageLabel = (s: string): string => (STAGE_LABELS as Record<string, string>)[s] ?? s;
function awsTone(s: string): "ok" | "danger" | "warn" | "neutral" | "info" {
  if (s === "confirmed") return "ok";
  if (s === "declined" || s === "expired" || s === "deleted") return "danger";
  if (s === "pending_partner_action") return "warn";
  if (s === "draft") return "neutral";
  return "info";
}

const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 8px",
  color: "var(--text)",
  fontSize: 13,
} as const;

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const today = new Date().toISOString().slice(0, 10);
  const aiEnabled = Boolean(env.ANTHROPIC_API_KEY);

  const data = await withTenant(identity, async (tx) => {
    const [program] = await tx
      .select()
      .from(programs)
      .where(and(eq(programs.id, id), eq(programs.tenantId, identity.tenantId)));
    if (!program) return null;
    const reqs = await tx
      .select({
        id: programRequirements.id,
        requirementKey: programRequirements.requirementKey,
        label: programRequirements.label,
        expectedEvidenceType: programRequirements.expectedEvidenceType,
        status: programRequirements.status,
        ownerUserId: programRequirements.ownerUserId,
        targetDate: programRequirements.targetDate,
        evidenceId: programRequirements.evidenceId,
        evidenceStatus: evidence.status,
        taskId: programRequirements.taskId,
        taskStatus: tasks.status,
      })
      .from(programRequirements)
      .leftJoin(evidence, eq(evidence.id, programRequirements.evidenceId))
      .leftJoin(tasks, eq(tasks.id, programRequirements.taskId))
      .where(
        and(
          eq(programRequirements.programId, id),
          eq(programRequirements.tenantId, identity.tenantId),
        ),
      )
      .orderBy(asc(programRequirements.createdAt));
    const members = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.tenantId, identity.tenantId));
    const evidenceList = await tx
      .select({ id: evidence.id, title: evidence.title, status: evidence.status })
      .from(evidence)
      .where(and(eq(evidence.tenantId, identity.tenantId), ne(evidence.status, "missing")))
      .orderBy(asc(evidence.title));
    const linkedSolutions = await tx
      .select({ id: solutions.id, title: solutions.title, availability: solutions.availability })
      .from(solutions)
      .where(and(eq(solutions.programId, id), eq(solutions.tenantId, identity.tenantId)))
      .orderBy(asc(solutions.title));
    return { program, reqs, members, evidenceList, linkedSolutions };
  });

  if (!data) notFound();
  const { program, reqs, members, evidenceList, linkedSolutions } = data;

  // Competency ROI: attributed ACE opportunities + the AWS segment/team behind them.
  const roiDetail =
    program.programType === "Competency" ? await loadProgramRoiDetail(identity, id) : null;
  // Submit stage: the self-assessment workbook(s) linked to this program.
  const applications = await loadApplicationsForProgram(identity, id);

  const states: RequirementState[] = reqs.map((r) => ({
    status: r.status,
    evidenceApproved: r.evidenceStatus === "approved",
  }));
  const gate = computeReadinessGate(program.status as ProgramStatusValue, states, program.expirationDate, today);
  const prog = requirementProgress(states);
  const statusForSelect = program.status === "submitted" ? "active" : program.status;

  const oppColumns: Column<RoiOppRow>[] = [
    { key: "name", header: "Opportunity", render: (o) => o.name },
    { key: "stage", header: "Stage", render: (o) => stageLabel(o.stage) },
    { key: "status", header: "Status", render: (o) => <Badge tone={statusTone(o.status)}>{o.status}</Badge> },
    { key: "amount", header: "Amount", align: "right", render: (o) => money(o.amount) },
    { key: "close", header: "Close", render: (o) => o.closeDate ?? "—" },
    {
      key: "infl",
      header: "Influenced",
      render: (o) =>
        o.influencedWon ? <Badge tone="ok">Won since achieved</Badge> : <span style={spanStyle}>—</span>,
    },
  ];
  const repColumns: Column<RepRollup>[] = [
    { key: "name", header: "AWS rep", render: (r) => r.name },
    { key: "title", header: "Title", render: (r) => AWS_ORG_TITLE_LABELS[r.primaryTitle] },
    { key: "open", header: "Open", align: "right", render: (r) => money(r.openTCV) },
    { key: "won", header: "Won", align: "right", render: (r) => money(r.closedWonTCV) },
  ];

  return (
    <PageShell width={880}>
      <PageHeader
        breadcrumbs={[{ href: "/", label: "Home" }, { href: "/programs", label: "Programs" }, { label: program.name }]}
        title={program.name}
        subtitle={
          <>
            {program.programType} · {program.deliveryModel} · {program.status} ·{" "}
            {prog.met}/{prog.total} met · <strong>{GATE_LABELS[gate]}</strong>
            {program.expirationDate ? ` · expires ${program.expirationDate}` : ""}
          </>
        }
        actions={
          <FormDrawer
            triggerLabel="Edit program"
            triggerVariant="secondary"
            title="Edit program"
            action={updateProgram}
            submitLabel="Save changes"
            successMessage="Program updated."
            submitVariant="secondary"
            hidden={{ programId: program.id }}
          >
            <label style={labelStyle}>
              <span style={spanStyle}>Status</span>
              <select name="status" defaultValue={statusForSelect} style={controlStyle}>
                <option value="pending">Pending</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
              </select>
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Owner</span>
              <select name="ownerUserId" defaultValue={program.ownerUserId ?? ""} style={controlStyle}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.email}</option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Expiration</span>
              <input name="expirationDate" type="date" defaultValue={program.expirationDate ?? ""} style={controlStyle} />
            </label>
          </FormDrawer>
        }
      />

      {program.status === "pending" && (
        <Panel title="Submission" accent="var(--section-accent)" icon={<IconPrograms size={16} />}>
          {gate === "ready_for_roadmap" ? (
            <>
              <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
                Every requirement is met with approved evidence. Approving records an
                auditable submission receipt.
              </p>
              <MutationForm action={submitProgram} submitLabel="Approve & submit" hidden={{ programId: program.id }} />
            </>
          ) : (
            <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>
              Not yet submission-ready ({GATE_LABELS[gate]}). Every requirement must be
              met with approved evidence before submission.
            </p>
          )}
        </Panel>
      )}

      {roiDetail && (
        <Panel title="Program ROI" accent="var(--section-accent)">
          <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13 }}>
            ACE opportunities credited to this competency
            {roiDetail.achievedAt ? <> · achieved ~{roiDetail.achievedAt}</> : <> · not yet achieved</>}
          </p>
          <div style={{ marginBottom: 16 }}>
            <MetricStrip min={140}>
              <MetricCard label="Attributed deals" value={String(roiDetail.roi.attributedCount)} />
              <MetricCard label="Open pipeline" value={money(roiDetail.roi.openTCV)} tone="info" />
              <MetricCard label="Won TCV" value={money(roiDetail.roi.wonTCV)} tone="ok" />
              <MetricCard label="Launched" value={String(roiDetail.roi.launchedCount)} />
              <MetricCard
                label="Won since achieved"
                value={roiDetail.roi.influencedWonTCV === null ? "—" : money(roiDetail.roi.influencedWonTCV)}
                tone="ok"
              />
            </MetricStrip>
          </div>

          <Table
            columns={oppColumns}
            rows={roiDetail.opportunities}
            rowKey={(o) => o.id}
            empty="No opportunities attributed yet — tag deals to this competency in ACE."
          />

          {roiDetail.byRole.length > 0 && (
            <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
              <strong style={{ fontSize: 13 }}>AWS teams behind this competency</strong>
              <BarChart
                color="var(--accent-2)"
                data={roiDetail.byRole.map((r) => ({
                  label: AWS_ORG_TITLE_LABELS[r.title],
                  value: r.openTCV + r.closedWonTCV,
                  display: money(r.openTCV + r.closedWonTCV),
                }))}
              />
              {roiDetail.reps.length > 0 && (
                <Table columns={repColumns} rows={roiDetail.reps} rowKey={(r) => r.id} empty="No AWS reps linked." />
              )}
            </div>
          )}
        </Panel>
      )}

      <Panel
        title={`Requirements (${reqs.length})`}
        accent="var(--section-accent)"
        actions={
          <Link href="/programs?view=fit" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13 }}>
            Coverage analysis →
          </Link>
        }
      >
        <div style={{ display: "grid", gap: 14 }}>
          {/* Grouped by status so long requirement lists stay scannable: what's
              actionable stays expanded, what's done folds away. */}
          {([
            { key: "open", label: "Open", open: true },
            { key: "blocked", label: "Blocked", open: true },
            { key: "met", label: "Met", open: false },
          ] as const).map((group) => {
            const items = reqs.filter((r) => r.status === group.key);
            if (items.length === 0) return null;
            return (
          <details key={group.key} open={group.open}>
            <summary style={{ cursor: "pointer", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", fontWeight: 600, marginBottom: 10 }}>
              {group.label} ({items.length})
            </summary>
            <div style={{ display: "grid", gap: 14 }}>
          {items.map((r) => (
            <Card key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{r.label}</strong>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 12 }}>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  · expects {r.expectedEvidenceType.replace(/_/g, " ")}
                </span>
              </div>

              <p style={{ fontSize: 12, margin: "8px 0 10px", display: "flex", gap: 16, flexWrap: "wrap" }}>
                <span>
                  Evidence:{" "}
                  {r.evidenceId ? (
                    <Link href="/programs/evidence" style={{ color: "var(--accent)" }}>
                      linked ({r.evidenceStatus})
                    </Link>
                  ) : (
                    <span style={spanStyle}>none</span>
                  )}
                </span>
                <span>
                  Task:{" "}
                  {r.taskId ? (
                    <Link href="/command/tasks" style={{ color: "var(--accent)" }}>
                      created ({r.taskStatus})
                    </Link>
                  ) : (
                    <span style={spanStyle}>none</span>
                  )}
                </span>
              </p>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <FormDrawer
                  triggerLabel="Edit"
                  triggerVariant="secondary"
                  title={`Edit requirement — ${r.label}`}
                  action={updateRequirement}
                  submitLabel="Save changes"
                  successMessage="Requirement updated."
                  submitVariant="secondary"
                  hidden={{ requirementId: r.id, programId: program.id }}
                >
                  <label style={labelStyle}>
                    <span style={spanStyle}>Status</span>
                    <select name="status" defaultValue={r.status} style={controlStyle}>
                      <option value="open">Open</option>
                      <option value="met">Met</option>
                      <option value="blocked">Blocked</option>
                    </select>
                  </label>
                  <label style={labelStyle}>
                    <span style={spanStyle}>Owner</span>
                    <select name="ownerUserId" defaultValue={r.ownerUserId ?? ""} style={controlStyle}>
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>{m.email}</option>
                      ))}
                    </select>
                  </label>
                  <label style={labelStyle}>
                    <span style={spanStyle}>Target date</span>
                    <input name="targetDate" type="date" defaultValue={r.targetDate ?? ""} style={controlStyle} />
                  </label>
                </FormDrawer>

                {(evidenceList.length > 0 || r.evidenceId) && (
                  <FormDrawer
                    triggerLabel={r.evidenceId ? "Change evidence" : "Link evidence"}
                    triggerVariant="secondary"
                    title={`Link evidence — ${r.label}`}
                    action={linkRequirementEvidence}
                    submitLabel="Save"
                    successMessage="Evidence link updated."
                    submitVariant="secondary"
                    hidden={{ requirementId: r.id, programId: program.id }}
                  >
                    <label style={labelStyle}>
                      <span style={spanStyle}>Evidence</span>
                      <select name="evidenceId" defaultValue={r.evidenceId ?? ""} style={controlStyle}>
                        <option value="">— none (unlink) —</option>
                        {evidenceList.map((e) => (
                          <option key={e.id} value={e.id}>{e.title} ({e.status})</option>
                        ))}
                      </select>
                    </label>
                  </FormDrawer>
                )}

                {!r.taskId && (
                  <MutationForm action={createRequirementTask} submitLabel="Create task" variant="secondary" hidden={{ requirementId: r.id, programId: program.id }} />
                )}
                {!r.evidenceId && (
                  <MutationForm action={stageRequirementEvidence} submitLabel="Stage evidence" variant="secondary" hidden={{ requirementId: r.id, programId: program.id }} />
                )}
              </div>

              {r.evidenceId && aiEnabled && (
                <div style={{ marginTop: 10 }}>
                  <EvaluateEvidence evidenceId={r.evidenceId} requirementId={r.id} enabled={aiEnabled} />
                </div>
              )}
            </Card>
          ))}
            </div>
          </details>
            );
          })}
        </div>
      </Panel>

      <Panel
        title={`Applications (${applications.length})`}
        accent="var(--section-accent)"
        icon={<IconApplications size={16} />}
        actions={
          <Link href="/programs/applications" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13 }}>
            Upload application →
          </Link>
        }
      >
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
          AWS self-assessment workbooks submitted for this program. Link a workbook to this program
          from its submission packet.
        </p>
        {applications.length === 0 ? (
          <EmptyState
            title="No applications linked"
            hint="Upload the self-assessment workbook, then link it to this program from the packet editor."
            action={
              <Link href="/programs/applications" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600, fontSize: 13 }}>
                Go to Submit →
              </Link>
            }
          />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {applications.map((a) => (
              <Card key={a.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Link
                    href={`/programs/applications/${a.id}`}
                    style={{ color: "var(--accent)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}
                  >
                    {a.name}
                  </Link>
                  <Badge tone={awsTone(a.awsStatus)}>{awsStatusLabel(a.awsStatus)}</Badge>
                </div>
                <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 0" }}>
                  <strong style={{ color: "var(--text)" }}>{a.acceptedCount}</strong>/{a.controlCount} controls accepted ·{" "}
                  {a.sourceFileName}
                </p>
              </Card>
            ))}
          </div>
        )}
      </Panel>

      {linkedSolutions.length > 0 && (
        <Panel
          title={`Solutions (${linkedSolutions.length})`}
          accent="var(--section-accent)"
          icon={<IconSolutions size={16} />}
          actions={
            <Link
              href="/programs?view=solutions"
              style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13 }}
            >
              All Solutions →
            </Link>
          }
        >
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
            Validated Solutions owned by this competency — their renewal readiness keeps the
            designation current.
          </p>
          <ChipList
            items={linkedSolutions.map((s) => ({
              key: s.id,
              label: s.title,
              href: `/programs/solutions/${s.id}`,
              badges: (
                <Badge tone={s.availability === "available" ? "ok" : s.availability === "beta" ? "info" : "danger"}>
                  {availabilityLabel(s.availability)}
                </Badge>
              ),
            }))}
          />
        </Panel>
      )}
    </PageShell>
  );
}
