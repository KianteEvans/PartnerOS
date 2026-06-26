import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { loadApplications } from "@/domain/applications/load";
import { UploadApplication } from "@/app/applications/UploadApplication";
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

  return (
    <PageShell>
      <PageHeader
        title="AWS Specialization Applications"
        subtitle="Upload a Competency, Service Delivery, Service Ready, MSP, or FTR self-assessment and draft each Partner Response from your evidence."
        actions={<UploadApplication />}
      />

      {apps.length === 0 ? (
        <Panel>
          <EmptyState
            title="No applications yet"
            hint="Upload an AWS Specialization self-assessment workbook (.xlsx) — Competency, Service Delivery, Service Ready, MSP, or FTR — and we'll draft each Partner Response, grounded in your Evidence Locker."
            action={<UploadApplication />}
          />
        </Panel>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {apps.map((a) => (
            <Card key={a.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <Link
                  href={`/applications/${a.id}`}
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
      )}
    </PageShell>
  );
}
