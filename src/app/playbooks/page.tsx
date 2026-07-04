import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { MetricCard } from "@/components/ui/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { MutationForm } from "@/components/ui/MutationForm";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { PlaybooksNav } from "@/app/playbooks/PlaybooksNav";
import { NewPlaybookDrawer } from "@/app/playbooks/NewPlaybookDrawer";
import { loadPlaybooks, loadRuns, loadMembers } from "@/domain/playbooks/load";
import { togglePlaybook, deletePlaybook, updatePlaybook } from "@/domain/playbooks/actions";
import { ACTION_CATALOG, type PlaybookActionType } from "@/domain/playbooks/catalog";
import { SITUATION_LABELS } from "@/domain/command/brief";
import type { Situation } from "@/domain/command/brief";

const SEV_TONE = { critical: "danger", high: "warn", medium: "info" } as const;
const CHANNEL_LABELS: Record<string, string> = { in_app: "In-app", email: "Email", webhook: "Webhook" };
const drawerControl = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "inherit",
} as const;
const drawerLabel = { display: "grid", gap: 4, fontSize: 13 } as const;
const drawerSpan = { fontWeight: 600, color: "var(--muted)" } as const;

export default async function PlaybooksPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");

  const [rules, runs, members] = await Promise.all([
    loadPlaybooks(identity),
    loadRuns(identity, 200),
    loadMembers(identity),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const active = rules.filter((r) => r.enabled).length;
  const runsToday = runs.filter((r) => r.createdAt.toISOString().slice(0, 10) === today).length;
  const pending = runs.filter((r) => r.status === "pending_approval").length;

  return (
    <PageShell>
      <PageHeader
        title="Playbooks"
        subtitle="Turn the cross-domain signal queue into action — rules that create tasks, route deals, approve within a cap, generate reports, or notify. ACE can't act on signals it can't see."
        actions={<NewPlaybookDrawer members={members} />}
      />
      <PlaybooksNav />

      <MetricStrip>
        <MetricCard label="Active rules" value={String(active)} sub={`${rules.length} total`} />
        <MetricCard label="Runs today" value={String(runsToday)} sub="fired since midnight" />
        <MetricCard label="Awaiting approval" value={String(pending)} tone={pending > 0 ? "warn" : "neutral"} sub="in Activity" />
        <MetricCard label="Governance" value="Mode-gated" sub="risk gate on every run" />
      </MetricStrip>

      {rules.length === 0 ? (
        <EmptyState
          title="No playbooks yet"
          hint="Create a rule to make the decision queue act on its own — e.g. 'funding deadline within 30 days → notify the owner'."
        />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rules.map((p) => {
            const action = ACTION_CATALOG[p.actionType as PlaybookActionType];
            return (
              <Card key={p.id} style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <strong style={{ fontSize: 14.5 }}>{p.name}</strong>
                    {p.description ? <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{p.description}</div> : null}
                  </div>
                  <Badge tone={p.enabled ? "ok" : "neutral"}>{p.enabled ? "Enabled" : "Disabled"}</Badge>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <Badge tone="neutral">When: {SITUATION_LABELS[p.triggerSituation as Situation] ?? p.triggerSituation}</Badge>
                  <Badge tone={SEV_TONE[p.triggerMinSeverity as keyof typeof SEV_TONE] ?? "info"}>≥ {p.triggerMinSeverity}</Badge>
                  <span style={{ color: "var(--muted)" }}>→</span>
                  <Badge tone="accent">{action ? action.label : p.actionType}</Badge>
                  {(p.channels ?? []).map((c) => (
                    <Badge key={c} tone="neutral">{CHANNEL_LABELS[c] ?? c}</Badge>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 2 }}>
                  <MutationForm
                    action={togglePlaybook}
                    submitLabel={p.enabled ? "Disable" : "Enable"}
                    variant="secondary"
                    hidden={{ playbookId: p.id, enabled: p.enabled ? "" : "on" }}
                  />
                  <FormDrawer
                    triggerLabel="Edit"
                    triggerVariant="secondary"
                    title="Edit playbook"
                    action={updatePlaybook}
                    submitLabel="Save changes"
                    successMessage="Playbook updated."
                    hidden={{ playbookId: p.id }}
                  >
                    <label style={drawerLabel}>
                      <span style={drawerSpan}>Name</span>
                      <input name="name" required maxLength={120} defaultValue={p.name} style={drawerControl} />
                    </label>
                    <label style={drawerLabel}>
                      <span style={drawerSpan}>Description</span>
                      <input name="description" maxLength={500} defaultValue={p.description ?? ""} style={drawerControl} />
                    </label>
                    <label style={drawerLabel}>
                      <span style={drawerSpan}>Minimum severity</span>
                      <select name="triggerMinSeverity" defaultValue={p.triggerMinSeverity} style={drawerControl}>
                        <option value="medium">Medium and above</option>
                        <option value="high">High and above</option>
                        <option value="critical">Critical only</option>
                      </select>
                    </label>
                    <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", display: "grid", gap: 6 }}>
                      <legend style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, padding: "0 4px" }}>Notify via</legend>
                      {(["in_app", "email", "webhook"] as const).map((c) => (
                        <label key={c} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                          <input type="checkbox" name="channels" value={c} defaultChecked={(p.channels ?? []).includes(c)} />
                          {CHANNEL_LABELS[c]}
                        </label>
                      ))}
                    </fieldset>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                      Trigger ({SITUATION_LABELS[p.triggerSituation as Situation] ?? p.triggerSituation}) and action (
                      {ACTION_CATALOG[p.actionType as PlaybookActionType]?.label ?? p.actionType}) are fixed at creation — to
                      change them, create a new rule and delete this one.
                    </p>
                  </FormDrawer>
                  <MutationForm
                    action={deletePlaybook}
                    submitLabel="Delete"
                    variant="danger"
                    successMessage="Playbook deleted."
                    hidden={{ playbookId: p.id }}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Callout tone="info" title="How runs are gated">
        Each rule&rsquo;s action carries a risk. Your workspace <strong>automation mode</strong> (Settings) decides whether a
        matching signal runs automatically, waits for approval, or is only recommended — high-risk actions (approve, route,
        external send) always require a human unless the mode explicitly allows them.
      </Callout>
    </PageShell>
  );
}
