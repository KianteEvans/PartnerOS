import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { programs, programRequirements, evidence, tasks, users } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Table, type Column } from "@/components/ui/Table";
import { BarChart } from "@/components/ui/BarChart";
import { MutationForm } from "@/components/ui/MutationForm";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { EvaluateEvidence } from "@/components/ui/EvaluateEvidence";
import { env } from "@/env";
import { loadProgramRoiDetail, type RoiOppRow } from "@/domain/programs/roi-load";
import { AWS_ORG_TITLE_LABELS, type RepRollup } from "@/domain/ace/sales-org";
import { STAGE_LABELS } from "@/domain/ace/opportunities";
import {
  updateProgram,
  updateRequirement,
  createRequirementTask,
  stageRequirementEvidence,
  submitProgram,
} from "@/domain/programs/actions";
import {
  computeReadinessGate,
  requirementProgress,
  GATE_LABELS,
  type RequirementState,
  type ProgramStatusValue,
} from "@/domain/programs/gate";

const labelStyle = { display: "grid", gap: 4, fontSize: 12 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const money = (n: number): string => `$${n.toLocaleString()}`;
const stageLabel = (s: string): string => (STAGE_LABELS as Record<string, string>)[s] ?? s;

function RoiStat({ label, value, accent }: { label: string; value: string; accent?: "ok" | "info" }): ReactNode {
  const color = accent === "ok" ? "var(--ok)" : accent === "info" ? "var(--info)" : "var(--text)";
  return (
    <div style={{ display: "grid", gap: 2, minWidth: 110 }}>
      <span style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
    </div>
  );
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
    return { program, reqs, members };
  });

  if (!data) notFound();
  const { program, reqs, members } = data;

  // Competency ROI: attributed ACE opportunities + the AWS segment/team behind them.
  const roiDetail =
    program.programType === "Competency" ? await loadProgramRoiDetail(identity, id) : null;

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
        <Panel title="Submission">
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
        <Panel title="Program ROI">
          <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13 }}>
            ACE opportunities credited to this competency
            {roiDetail.achievedAt ? <> · achieved ~{roiDetail.achievedAt}</> : <> · not yet achieved</>}
          </p>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 16 }}>
            <RoiStat label="Attributed deals" value={String(roiDetail.roi.attributedCount)} />
            <RoiStat label="Open pipeline" value={money(roiDetail.roi.openTCV)} accent="info" />
            <RoiStat label="Won TCV" value={money(roiDetail.roi.wonTCV)} accent="ok" />
            <RoiStat label="Launched" value={String(roiDetail.roi.launchedCount)} />
            <RoiStat
              label="Won since achieved"
              value={roiDetail.roi.influencedWonTCV === null ? "—" : money(roiDetail.roi.influencedWonTCV)}
              accent="ok"
            />
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

      <Panel title={`Requirements (${reqs.length})`}>
        <div style={{ display: "grid", gap: 14 }}>
          {reqs.map((r) => (
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
                    <Link href="/evidence" style={{ color: "var(--accent)" }}>
                      linked ({r.evidenceStatus})
                    </Link>
                  ) : (
                    <span style={spanStyle}>none</span>
                  )}
                </span>
                <span>
                  Task:{" "}
                  {r.taskId ? (
                    <Link href="/tasks" style={{ color: "var(--accent)" }}>
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
      </Panel>
    </PageShell>
  );
}
