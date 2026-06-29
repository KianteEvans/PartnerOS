import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { LifecycleNav } from "@/app/programs/LifecycleNav";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { EmptyState } from "@/components/ui/EmptyState";
import { loadApplications } from "@/domain/applications/load";
import { UploadApplication } from "@/app/programs/applications/UploadApplication";
import { awsStatusLabel } from "@/domain/applications/packet";

function awsTone(s: string): Tone {
  if (s === "confirmed") return "ok";
  if (s === "declined" || s === "expired" || s === "deleted") return "danger";
  if (s === "pending_partner_action") return "warn";
  if (s === "draft") return "neutral";
  return "info";
}

/**
 * Competency Applications: uploaded AWS Self-Assessment workbooks, each with its
 * controls and per-control drafted Partner Responses.
 */
export default async function ApplicationsPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const apps = await loadApplications(identity);

  const confirmed = apps.filter((a) => a.awsStatus === "confirmed").length;
  const inProgress = apps.filter((a) => a.awsStatus === "draft" || a.awsStatus === "pending_partner_action").length;
  const totalControls = apps.reduce((s, a) => s + a.controlCount, 0);
  const totalAccepted = apps.reduce((s, a) => s + a.acceptedCount, 0);
  const respondedPct = totalControls > 0 ? Math.round((totalAccepted / totalControls) * 100) : 0;

  return (
    <PageShell>
      <PageHeader
        title="AWS Specialization Applications"
        subtitle="Upload a Competency, Service Delivery, Service Ready, MSP, or FTR self-assessment and draft each Partner Response from your evidence."
        actions={<UploadApplication />}
      />
      <LifecycleNav />

      {apps.length === 0 ? (
        <Panel>
          <EmptyState
            title="No applications yet"
            hint="Upload an AWS Specialization self-assessment workbook (.xlsx) — Competency, Service Delivery, Service Ready, MSP, or FTR — and we'll draft each Partner Response, grounded in your Evidence Locker."
            action={<UploadApplication />}
          />
        </Panel>
      ) : (
        <>
          <MetricStrip min={150}>
            <MetricCard label="Applications" value={String(apps.length)} />
            <MetricCard label="Confirmed" value={String(confirmed)} tone={confirmed > 0 ? "ok" : "neutral"} />
            <MetricCard label="In progress" value={String(inProgress)} tone={inProgress > 0 ? "warn" : "neutral"} />
            <MetricCard label="Controls responded" value={`${respondedPct}%`} />
          </MetricStrip>
          <div style={{ display: "grid", gap: 12 }}>
            {apps.map((a) => (
            <Card key={a.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <Link
                  href={`/programs/applications/${a.id}`}
                  style={{ color: "var(--accent)", textDecoration: "none", fontSize: 15, fontWeight: 600 }}
                >
                  {a.name}
                </Link>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {a.programType && <Badge>{a.programType}</Badge>}
                  <Badge tone={awsTone(a.awsStatus)}>{awsStatusLabel(a.awsStatus)}</Badge>
                </div>
              </div>
              <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 0" }}>
                {a.competency || a.programType || "Specialization"} ·{" "}
                <strong style={{ color: "var(--text)" }}>{a.acceptedCount}</strong>/{a.controlCount} accepted ·{" "}
                {a.sourceFileName}
              </p>
            </Card>
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
