import type { ReactNode } from "react";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { mdfRequests, evidence, tasks, users } from "@/db/schema";
import { can } from "@/authz/permissions";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, statusTone } from "@/components/ui/Badge";
import { MutationForm } from "@/components/ui/MutationForm";
import { FormDrawer } from "@/components/ui/FormDrawer";
import {
  updateMdfRequest,
  submitMdfRequest,
  approveMdfRequest,
  rejectMdfRequest,
  deployMdfRequest,
  claimMdfRequest,
  reimburseMdfRequest,
  stageMdfProof,
  createMdfTask,
} from "@/domain/mdf/actions";
import { MDF_STATUS_LABELS, type MdfStatus } from "@/domain/mdf/lifecycle";
import { preflight, roiMultiple, type MdfLike } from "@/domain/mdf/analytics";

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
const money = (n: number | null): string => (n == null ? "—" : `$${n.toLocaleString()}`);

export default async function MdfDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const canApprove = can(identity.role, "mdf:approve");

  const data = await withTenant(identity, async (tx) => {
    const [r] = await tx
      .select({
        req: mdfRequests,
        evidenceStatus: evidence.status,
        taskStatus: tasks.status,
      })
      .from(mdfRequests)
      .leftJoin(evidence, eq(evidence.id, mdfRequests.evidenceId))
      .leftJoin(tasks, eq(tasks.id, mdfRequests.taskId))
      .where(and(eq(mdfRequests.id, id), eq(mdfRequests.tenantId, identity.tenantId)));
    if (!r) return null;
    const members = await tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.tenantId, identity.tenantId));
    return { ...r, members };
  });

  if (!data) notFound();
  const req = data.req;
  const status = req.status as MdfStatus;
  const elig = preflight(req as MdfLike);
  const roi = roiMultiple(req as MdfLike);
  const ownerEmail = req.ownerUserId ? data.members.find((m) => m.id === req.ownerUserId)?.email : null;

  return (
    <PageShell width={860}>
      <PageHeader
        breadcrumbs={[{ href: "/", label: "Home" }, { href: "/mdf", label: "MDF" }, { label: req.title }]}
        title={req.title}
        actions={
          status === "draft" ? (
            <FormDrawer
              triggerLabel="Edit request"
              triggerVariant="secondary"
              title="Edit request"
              action={updateMdfRequest}
              submitLabel="Save changes"
              successMessage="Request updated."
              submitVariant="secondary"
              hidden={{ requestId: req.id }}
            >
              <label style={labelStyle}><span style={spanStyle}>Title</span><input name="title" required maxLength={200} defaultValue={req.title} style={controlStyle} /></label>
              <label style={labelStyle}>
                <span style={spanStyle}>Activity</span>
                <select name="activityType" defaultValue={req.activityType} style={controlStyle}>
                  {["event", "campaign", "content", "enablement", "other"].map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <label style={labelStyle}><span style={spanStyle}>Requested ($)</span><input name="requestedAmount" type="number" min={0} defaultValue={req.requestedAmount} style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>Pipeline ($)</span><input name="expectedPipeline" type="number" min={0} defaultValue={req.expectedPipeline} style={controlStyle} /></label>
              <label style={labelStyle}>
                <span style={spanStyle}>Owner</span>
                <select name="ownerUserId" defaultValue={req.ownerUserId ?? ""} style={controlStyle}>
                  <option value="">Unassigned</option>
                  {data.members.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
                </select>
              </label>
              <label style={labelStyle}><span style={spanStyle}>Start</span><input name="startDate" type="date" defaultValue={req.startDate ?? ""} style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>End</span><input name="endDate" type="date" defaultValue={req.endDate ?? ""} style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>Claim by</span><input name="claimDeadline" type="date" defaultValue={req.claimDeadline ?? ""} style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>Opportunity</span><input name="opportunityRef" maxLength={200} defaultValue={req.opportunityRef ?? ""} style={controlStyle} /></label>
            </FormDrawer>
          ) : undefined
        }
      />

      <div>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>
          {req.activityType} · <Badge tone={statusTone(status)}>{MDF_STATUS_LABELS[status]}</Badge> · Owner {ownerEmail ?? "Unassigned"}
          {roi !== null ? ` · ROI ${roi}x` : ""}
        </p>
        <p style={{ color: "var(--muted)", margin: "8px 0 0", fontSize: 13, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span>Requested {money(req.requestedAmount)}</span>
          <span>Approved {money(req.approvedAmount)}</span>
          <span>Deployed {money(req.deployedAmount)}</span>
          <span>Claimed {money(req.claimedAmount)}</span>
          <span>Reimbursed {money(req.reimbursedAmount)}</span>
          <span>Pipeline {money(req.expectedPipeline)}</span>
        </p>
      </div>

      {status === "draft" && (
        <Panel title="Eligibility preflight">
          <div style={{ display: "grid", gap: 6 }}>
            {elig.checks.map((c) => (
              <div key={c.key} style={{ fontSize: 13 }}>
                <span style={{ color: c.ok ? "var(--accent)" : "var(--danger)" }}>{c.ok ? "✓" : "✗"}</span> {c.label}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Proof + task handoffs */}
      <Panel title="Proof & execution">
        <p style={{ fontSize: 13, margin: 0, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span>
            Proof: {req.evidenceId ? <Link href="/evidence" style={{ color: "var(--accent)" }}>linked ({data.evidenceStatus})</Link> : <span style={spanStyle}>none</span>}
          </span>
          {!req.evidenceId && <MutationForm action={stageMdfProof} submitLabel="Stage proof" variant="secondary" hidden={{ requestId: req.id }} />}
          <span>
            Task: {req.taskId ? <Link href="/tasks" style={{ color: "var(--accent)" }}>created ({data.taskStatus})</Link> : <span style={spanStyle}>none</span>}
          </span>
          {!req.taskId && <MutationForm action={createMdfTask} submitLabel="Create task" variant="secondary" hidden={{ requestId: req.id }} />}
        </p>
      </Panel>

      {/* Lifecycle workbench */}
      <Panel title="Lifecycle">
        <LifecycleControls req={req} status={status} eligible={elig.eligible} canApprove={canApprove} />
      </Panel>

      {req.reviewNotes && (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Review notes: {req.reviewNotes}</p>
      )}
    </PageShell>
  );
}

function LifecycleControls({
  req,
  status,
  eligible,
  canApprove,
}: {
  req: typeof mdfRequests.$inferSelect;
  status: MdfStatus;
  eligible: boolean;
  canApprove: boolean;
}): ReactNode {
  const amountField = (name: string, label: string, def: number) => (
    <label style={labelStyle}>
      <span style={spanStyle}>{label}</span>
      <input name={name} type="number" min={1} defaultValue={def} style={{ ...controlStyle, width: 140 }} />
    </label>
  );

  if (status === "draft") {
    return eligible ? (
      <MutationForm action={submitMdfRequest} submitLabel="Submit for approval" hidden={{ requestId: req.id }} />
    ) : (
      <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>Resolve the eligibility checks above, then submit.</p>
    );
  }
  if (status === "requested") {
    return canApprove ? (
      <div style={{ display: "grid", gap: 14 }}>
        <MutationForm action={approveMdfRequest} submitLabel="Approve" hidden={{ requestId: req.id }}>
          {amountField("approvedAmount", "Approved amount ($)", req.requestedAmount)}
          <label style={labelStyle}><span style={spanStyle}>Notes</span><input name="notes" maxLength={2000} style={controlStyle} /></label>
        </MutationForm>
        <div>
          <FormDrawer
            triggerLabel="Reject…"
            triggerVariant="danger"
            title="Reject request"
            action={rejectMdfRequest}
            submitLabel="Reject request"
            successMessage="Request rejected."
            submitVariant="danger"
            hidden={{ requestId: req.id }}
          >
            <label style={labelStyle}><span style={spanStyle}>Reason</span><input name="notes" maxLength={2000} style={controlStyle} /></label>
          </FormDrawer>
        </div>
      </div>
    ) : (
      <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>Submitted — awaiting approval by an admin or owner.</p>
    );
  }
  if (status === "approved") {
    return (
      <MutationForm action={deployMdfRequest} submitLabel="Mark deployed" hidden={{ requestId: req.id }}>
        {amountField("deployedAmount", "Deployed amount ($)", req.approvedAmount ?? 0)}
      </MutationForm>
    );
  }
  if (status === "deployed") {
    return req.evidenceId ? (
      <MutationForm action={claimMdfRequest} submitLabel="Submit claim" hidden={{ requestId: req.id }}>
        {amountField("claimedAmount", "Claimed amount ($)", req.deployedAmount ?? 0)}
      </MutationForm>
    ) : (
      <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>Attach proof-of-performance evidence (above) before claiming.</p>
    );
  }
  if (status === "claimed") {
    return (
      <MutationForm action={reimburseMdfRequest} submitLabel="Mark reimbursed" hidden={{ requestId: req.id }}>
        {amountField("reimbursedAmount", "Reimbursed amount ($)", req.claimedAmount ?? 0)}
      </MutationForm>
    );
  }
  return (
    <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>
      This request is {MDF_STATUS_LABELS[status].toLowerCase()} — no further actions.
    </p>
  );
}
