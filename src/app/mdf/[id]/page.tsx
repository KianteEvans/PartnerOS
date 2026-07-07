import type { ReactNode } from "react";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { mdfRequests, mdfPlanItems, evidence, tasks, users } from "@/db/schema";
import { can } from "@/authz/permissions";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { BarChart } from "@/components/ui/BarChart";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
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
import { preflight, roiMultiple, deadlineRisk, claimedShare, type MdfLike } from "@/domain/mdf/analytics";
import { daysBetween } from "@/domain/dates";
import { MdfLifecycleStepper } from "@/app/mdf/MdfLifecycleStepper";
import { activityByKey, APPROVED_ACTIVITIES, INELIGIBLE_ACTIVITIES } from "@/domain/mdf/activity-catalog";
import { coFunding, derivedDeadlines, complianceChecks } from "@/domain/mdf/compliance";
import { moneyOrDash as money } from "@/domain/format";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";

const SECTION = "var(--section-accent)";
const ACTIVITY_LABELS: Record<string, string> = {
  event: "Event",
  campaign: "Campaign",
  content: "Content",
  enablement: "Enablement",
  other: "Other",
};
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

export default async function MdfDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("mdf");
  if (fenced) return <PackageFence feature="mdf" previewTier={fenced} />;
  const canApprove = can(identity.role, "mdf:approve");

  const data = await withTenant(identity, async (tx) => {
    const [r] = await tx
      .select({
        req: mdfRequests,
        evidenceStatus: evidence.status,
        taskStatus: tasks.status,
        planId: mdfPlanItems.planId,
      })
      .from(mdfRequests)
      .leftJoin(evidence, eq(evidence.id, mdfRequests.evidenceId))
      .leftJoin(tasks, eq(tasks.id, mdfRequests.taskId))
      .leftJoin(mdfPlanItems, eq(mdfPlanItems.requestId, mdfRequests.id))
      .where(and(eq(mdfRequests.id, id), eq(mdfRequests.tenantId, identity.tenantId)));
    if (!r) return null;
    const members = await tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.tenantId, identity.tenantId));
    return { ...r, members };
  });

  if (!data) notFound();
  const req = data.req;
  const status = req.status as MdfStatus;
  const today = new Date().toISOString().slice(0, 10);
  const elig = preflight(req as MdfLike);
  const roi = roiMultiple(req as MdfLike);
  const atRisk = deadlineRisk(req as MdfLike, today);
  const claimedPct = claimedShare(req as MdfLike);
  const daysToDeadline = req.claimDeadline ? daysBetween(today, req.claimDeadline) : null;
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
              <label style={labelStyle}>
                <span style={spanStyle}>AWS activity</span>
                <select name="catalogKey" defaultValue={req.catalogKey ?? ""} style={controlStyle}>
                  <option value="">— None —</option>
                  <optgroup label="Approved">
                    {APPROVED_ACTIVITIES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </optgroup>
                  <optgroup label="Ineligible (blocks submission)">
                    {INELIGIBLE_ACTIVITIES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </optgroup>
                </select>
              </label>
              <label style={labelStyle}><span style={spanStyle}>Total cost ($)</span><input name="totalCost" type="number" min={0} defaultValue={req.totalCost ?? ""} style={controlStyle} /></label>
            </FormDrawer>
          ) : undefined
        }
      />

      {data.planId && (
        <Callout tone="info">
          Converted from a marketing plan ·{" "}
          <Link href={`/mdf/plan/${data.planId}`} style={{ color: "var(--accent)", fontWeight: 600 }}>
            Open the plan →
          </Link>
        </Callout>
      )}

      {atRisk && daysToDeadline !== null && (
        <Callout
          tone={daysToDeadline < 0 ? "danger" : "warn"}
          title={
            daysToDeadline < 0
              ? `Claim deadline passed ${Math.abs(daysToDeadline)} day${Math.abs(daysToDeadline) === 1 ? "" : "s"} ago`
              : `Claim deadline in ${daysToDeadline} day${daysToDeadline === 1 ? "" : "s"}`
          }
        >
          {req.claimDeadline}. Submit the claim before the funds expire.
        </Callout>
      )}

      <p style={{ color: "var(--muted)", margin: 0, fontSize: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Badge tone="info">{ACTIVITY_LABELS[req.activityType] ?? req.activityType}</Badge> ·{" "}
        <Badge tone={statusTone(status)}>{MDF_STATUS_LABELS[status]}</Badge> · Owner {ownerEmail ?? "Unassigned"}
      </p>

      <Panel title="Lifecycle stage" accent={SECTION}>
        <MdfLifecycleStepper status={status} />
      </Panel>

      {req.catalogKey ? <AwsCompliancePanel req={req} today={today} /> : null}

      <Panel title="Funding progress" accent={SECTION}>
        <BarChart
          max={Math.max(1, req.requestedAmount)}
          data={[
            { label: "Requested", value: req.requestedAmount, display: money(req.requestedAmount), color: "var(--info)" },
            { label: "Approved", value: req.approvedAmount ?? 0, display: money(req.approvedAmount), color: "var(--accent)" },
            { label: "Deployed", value: req.deployedAmount ?? 0, display: money(req.deployedAmount), color: "var(--accent)" },
            { label: "Claimed", value: req.claimedAmount ?? 0, display: money(req.claimedAmount), color: "var(--warn)" },
            { label: "Reimbursed", value: req.reimbursedAmount ?? 0, display: money(req.reimbursedAmount), color: "var(--ok)" },
          ]}
        />
        <div style={{ marginTop: 14 }}>
          <MetricStrip min={130}>
            <MetricCard label="ROI multiple" value={roi == null ? "—" : `${roi}x`} tone="accent" />
            <MetricCard label="% of approved claimed" value={`${claimedPct}%`} />
            <MetricCard label="Pipeline" value={money(req.expectedPipeline)} />
            <MetricCard
              label="Claim deadline"
              value={daysToDeadline === null ? "—" : daysToDeadline < 0 ? `${Math.abs(daysToDeadline)}d ago` : `${daysToDeadline}d`}
              tone={atRisk ? "danger" : "neutral"}
            />
          </MetricStrip>
        </div>
      </Panel>

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
            Proof: {req.evidenceId ? <Link href="/programs/evidence" style={{ color: "var(--accent)" }}>linked ({data.evidenceStatus})</Link> : <span style={spanStyle}>none</span>}
          </span>
          {!req.evidenceId && <MutationForm action={stageMdfProof} submitLabel="Stage proof" variant="secondary" hidden={{ requestId: req.id }} />}
          <span>
            Task: {req.taskId ? <Link href="/command/tasks" style={{ color: "var(--accent)" }}>created ({data.taskStatus})</Link> : <span style={spanStyle}>none</span>}
          </span>
          {!req.taskId && <MutationForm action={createMdfTask} submitLabel="Create task" variant="secondary" hidden={{ requestId: req.id }} />}
        </p>
      </Panel>

      {/* Lifecycle workbench */}
      <Panel title="Lifecycle" accent={SECTION}>
        <LifecycleControls req={req} status={status} eligible={elig.eligible} canApprove={canApprove} />
      </Panel>

      {req.reviewNotes && (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Review notes: {req.reviewNotes}</p>
      )}
    </PageShell>
  );
}

/** AWS compliance for a catalog-grounded request: eligibility, co-fund, deadlines, flags. */
function AwsCompliancePanel({
  req,
  today,
}: {
  req: typeof mdfRequests.$inferSelect;
  today: string;
}): ReactNode {
  const activity = activityByKey(req.catalogKey);
  const total = req.totalCost ?? req.requestedAmount;
  const co = coFunding(total, 50);
  const deadlines = derivedDeadlines(req.startDate, req.endDate);
  const checks = complianceChecks(
    {
      catalogKey: req.catalogKey,
      startDate: req.startDate,
      endDate: req.endDate,
      totalCost: total,
      coFundPct: 50,
      brandingConfirmed: req.awsBrandingConfirmed,
    },
    today,
  );
  const flags = checks.filter((c) => c.severity !== "ok");
  const blocked = checks.some((c) => c.severity === "block");
  return (
    <Panel title="AWS compliance" accent={SECTION}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        {activity ? (
          <Badge tone={activity.eligibility === "approved" ? "ok" : "danger"}>{activity.label}</Badge>
        ) : null}
        <Badge tone={blocked ? "danger" : "ok"}>{blocked ? "Blocked by AWS rules" : "Clears AWS rules"}</Badge>
      </div>
      {activity?.reason ? <p style={{ fontSize: 12.5, color: "var(--danger)", margin: "0 0 8px" }}>{activity.reason}</p> : null}
      {activity?.proofRequirement ? (
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>Proof at claim: {activity.proofRequirement}</p>
      ) : null}
      <MetricStrip min={120}>
        <MetricCard label="Total cost" value={money(total)} />
        <MetricCard label="AWS ask (50%)" value={money(co.amountToClaim)} tone="accent" />
        <MetricCard label="Your share" value={money(co.partnerShare)} />
        <MetricCard label="Submit by" value={deadlines.submitBy ?? "—"} />
        <MetricCard label="Claim by" value={deadlines.claimBy ?? "—"} />
      </MetricStrip>
      {flags.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          {flags.map((f) => (
            <div key={f.key} style={{ display: "flex", gap: 8, fontSize: 12.5 }}>
              <span style={{ color: f.severity === "block" ? "var(--danger)" : "var(--warn)", fontWeight: 700, whiteSpace: "nowrap" }}>
                {f.severity === "block" ? "Blocked" : "Warning"}
              </span>
              <span>{f.message}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
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
