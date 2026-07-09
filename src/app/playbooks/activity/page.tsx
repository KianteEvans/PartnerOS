import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { MutationForm } from "@/components/ui/MutationForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlaybooksNav } from "@/app/playbooks/PlaybooksNav";
import { loadRuns, loadInbox, type PlaybookRunRow } from "@/domain/playbooks/load";
import { approvePlaybookRun, dismissPlaybookRun, markNotificationRead } from "@/domain/playbooks/actions";
import { RUN_STATUS_LABELS, type RunStatus } from "@/domain/playbooks/lifecycle";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";

const STATUS_TONE: Record<RunStatus, "neutral" | "info" | "ok" | "danger" | "warn"> = {
  recommended: "info",
  pending_approval: "warn",
  executed: "ok",
  failed: "danger",
  dismissed: "neutral",
};
const VERDICT_TONE: Record<string, "neutral" | "info" | "ok" | "warn"> = {
  auto: "ok",
  approval: "warn",
  recommend: "info",
  blocked: "neutral",
};

function resultSummary(r: PlaybookRunRow): string {
  const res = r.result as Record<string, unknown>;
  if (res.error) return `Error: ${String(res.error)}`;
  if (res.taskId) return "Task created";
  if (res.reportId) return "Report generated";
  if (res.approvedAmount) return `Approved ${res.approvedAmount}`;
  if (res.opportunityId) return "Opportunity routed";
  if (res.notified) return "Notification sent";
  return "—";
}

export default async function PlaybookActivityPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("playbooks");
  if (fenced) return <PackageFence feature="playbooks" previewTier={fenced} />;
  const [runs, inbox] = await Promise.all([loadRuns(identity, 200), loadInbox(identity, 30)]);
  const sevTone = (s: string): "danger" | "warn" | "info" => (s === "critical" ? "danger" : s === "high" ? "warn" : "info");

  const columns: Column<PlaybookRunRow>[] = [
    { key: "playbook", header: "Playbook", render: (r) => <strong style={{ fontSize: 13 }}>{r.playbookName}</strong> },
    {
      key: "trigger",
      header: "Trigger",
      render: (r) => {
        const d = r.decision as { title?: string; link?: string };
        return d.title ?? r.decisionId;
      },
    },
    { key: "verdict", header: "Verdict", render: (r) => <Badge tone={VERDICT_TONE[r.verdict] ?? "neutral"}>{r.verdict}</Badge> },
    { key: "status", header: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status as RunStatus] ?? "neutral"}>{RUN_STATUS_LABELS[r.status as RunStatus] ?? r.status}</Badge> },
    { key: "result", header: "Result", render: (r) => <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{resultSummary(r)}</span> },
    { key: "when", header: "When", render: (r) => r.createdAt.toISOString().slice(0, 10) },
    {
      key: "act",
      header: "",
      render: (r) =>
        r.status === "pending_approval" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <MutationForm action={approvePlaybookRun} submitLabel="Approve" successMessage="Executed." hidden={{ runId: r.id }} />
            <MutationForm action={dismissPlaybookRun} submitLabel="Dismiss" variant="secondary" successMessage="Dismissed." hidden={{ runId: r.id }} />
          </div>
        ) : null,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Playbook activity"
        subtitle="Every time a rule fired — auto-executed, awaiting your approval, or recommended. Approve a pending run to execute its action now."
      />
      <PlaybooksNav />
      <Table columns={columns} rows={runs} rowKey={(r) => r.id} empty="No playbook runs yet. When a signal matches a rule, it lands here." />

      <Panel title={`Notifications${inbox.unread > 0 ? ` · ${inbox.unread} unread` : ""}`} accent="var(--section-accent)">
        {inbox.items.length === 0 ? (
          <EmptyState title="No notifications yet" hint="Playbook notifications will appear here as rules fire." />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {inbox.items.map((n) => (
              <Card key={n.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: n.readAt ? 400 : 700 }}>{n.title}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{n.body}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Badge tone={sevTone(n.severity)}>{n.severity}</Badge>
                  {n.readAt ? null : (
                    <MutationForm action={markNotificationRead} submitLabel="Mark read" variant="secondary" hidden={{ notificationId: n.id }} />
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
