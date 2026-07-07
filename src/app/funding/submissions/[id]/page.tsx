import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { MetricCard } from "@/components/ui/MetricCard";
import { MutationForm } from "@/components/ui/MutationForm";
import { loadSubmissionDetail } from "@/domain/funding/load";
import { lifecycleSteps, FUNDING_STATUS_LABELS } from "@/domain/funding/lifecycle";
import { getFundingProgram } from "@/domain/funding/catalog";
import {
  submitFundingSubmission,
  startFundingReview,
  approveFundingSubmission,
  rejectFundingSubmission,
  markFundingFunded,
  withdrawFundingSubmission,
} from "@/domain/funding/actions";
import { money } from "@/domain/format";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";


const control: CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 14,
};
const lbl: CSSProperties = { display: "grid", gap: 4, fontSize: 13 };

const STEP_COLOR = { done: "var(--ok)", current: "var(--section-accent)", upcoming: "var(--border)", terminal: "var(--danger)" } as const;

export default async function FundingSubmissionDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("funding");
  if (fenced) return <PackageFence feature="funding" previewTier={fenced} />;
  const { id } = await params;
  const data = await loadSubmissionDetail(identity, id);
  if (!data) notFound();
  const { submission: s, opportunity } = data;
  const program = getFundingProgram(s.programKey);
  const steps = lifecycleSteps(s.status);
  const hidden = <input type="hidden" name="submissionId" value={s.id} />;

  return (
    <PageShell width={880}>
      <PageHeader
        title={s.title}
        breadcrumbs={[
          { href: "/funding/submissions", label: "Funding submissions" },
          { label: s.title },
        ]}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Badge tone="neutral">{program?.name ?? s.programKey}</Badge>
        <Badge tone="neutral">{s.fundingType === "credits" ? "AWS credits" : "Cash"}</Badge>
        <Badge tone="neutral">{FUNDING_STATUS_LABELS[s.status]}</Badge>
        {opportunity ? (
          <Link href={`/ace?tab=opportunities#opp-${opportunity.id}`} style={{ fontSize: 12.5, color: "var(--section-accent)", textDecoration: "none" }}>
            Linked deal: {opportunity.name} →
          </Link>
        ) : null}
      </div>

      {/* Lifecycle stepper */}
      <Panel title="Lifecycle" accent="var(--section-accent)">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {steps.map((st) => (
            <span
              key={st.key}
              style={{
                padding: "5px 12px",
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: st.state === "current" ? 700 : 500,
                border: `1.5px solid ${STEP_COLOR[st.state]}`,
                color: st.state === "upcoming" ? "var(--muted)" : STEP_COLOR[st.state],
                background: st.state === "current" ? "color-mix(in srgb, var(--section-accent) 12%, transparent)" : "transparent",
              }}
            >
              {st.label}
            </span>
          ))}
        </div>
      </Panel>

      <MetricStrip>
        <MetricCard label="Requested" value={money(s.requestedAmount)} sub={s.currency} />
        <MetricCard label="Approved" value={s.approvedAmount == null ? "—" : money(s.approvedAmount)} tone={s.approvedAmount ? "ok" : "neutral"} sub="if decided" />
        <MetricCard label="Deadline" value={s.deadline ?? "—"} sub="response due" />
        <MetricCard label="Workload" value={s.workloadType || "—"} sub={s.customerSegment || "segment n/a"} />
      </MetricStrip>

      {s.decisionNotes ? (
        <Callout tone={s.status === "rejected" ? "danger" : "info"} title="Decision notes">
          {s.decisionNotes}
        </Callout>
      ) : null}

      {/* Status workbench */}
      <Panel title="Next step">
        {s.status === "draft" && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <MutationForm action={submitFundingSubmission} submitLabel="Submit to AWS" successMessage="Submitted.">
              {hidden}
            </MutationForm>
            <MutationForm action={withdrawFundingSubmission} submitLabel="Withdraw" variant="secondary" successMessage="Withdrawn.">
              {hidden}
            </MutationForm>
          </div>
        )}

        {(s.status === "submitted" || s.status === "in_review") && (
          <div style={{ display: "grid", gap: 16 }}>
            {s.status === "submitted" && (
              <MutationForm action={startFundingReview} submitLabel="Mark in review" variant="secondary" successMessage="Moved to review.">
                {hidden}
              </MutationForm>
            )}
            <MutationForm action={approveFundingSubmission} submitLabel="Approve" successMessage="Approved.">
              {hidden}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ ...lbl, flex: 1, minWidth: 160 }}>
                  <span style={{ fontWeight: 600, color: "var(--muted)" }}>Approved amount (USD)</span>
                  <input name="approvedAmount" type="number" min={0} defaultValue={s.requestedAmount} style={control} />
                </label>
                <label style={{ ...lbl, flex: 2, minWidth: 200 }}>
                  <span style={{ fontWeight: 600, color: "var(--muted)" }}>Notes</span>
                  <input name="notes" maxLength={2000} placeholder="Approval notes" style={control} />
                </label>
              </div>
            </MutationForm>
            <MutationForm action={rejectFundingSubmission} submitLabel="Reject" variant="danger" successMessage="Rejected.">
              {hidden}
              <label style={lbl}>
                <span style={{ fontWeight: 600, color: "var(--muted)" }}>Reason</span>
                <input name="notes" maxLength={2000} placeholder="Why it was declined" style={control} />
              </label>
            </MutationForm>
          </div>
        )}

        {s.status === "approved" && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <MutationForm action={markFundingFunded} submitLabel="Mark funded" successMessage="Marked funded.">
              {hidden}
            </MutationForm>
            <MutationForm action={withdrawFundingSubmission} submitLabel="Withdraw" variant="secondary" successMessage="Withdrawn.">
              {hidden}
            </MutationForm>
          </div>
        )}

        {(s.status === "funded" || s.status === "rejected" || s.status === "withdrawn") && (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
            This submission is {FUNDING_STATUS_LABELS[s.status].toLowerCase()} — no further action.
          </p>
        )}
      </Panel>

      {program ? (
        <Panel title="Program">
          <p style={{ margin: "0 0 8px", fontSize: 13.5, lineHeight: 1.55 }}>{program.description}</p>
          <a href={program.applyUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "var(--section-accent)" }}>
            AWS Partner Funding Portal →
          </a>
        </Panel>
      ) : null}
    </PageShell>
  );
}
