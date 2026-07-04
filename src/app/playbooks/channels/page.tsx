import type { CSSProperties, ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { MutationForm } from "@/components/ui/MutationForm";
import { PlaybooksNav } from "@/app/playbooks/PlaybooksNav";
import { loadWebhooks } from "@/domain/playbooks/load";
import { createWebhook, toggleWebhook, deleteWebhook } from "@/domain/playbooks/actions";

const control: CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "inherit",
};
const label: CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
const span: CSSProperties = { fontWeight: 600, color: "var(--muted)" };

export default async function PlaybookChannelsPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const hooks = await loadWebhooks(identity);

  const addWebhook = (
    <FormDrawer triggerLabel="Add webhook" triggerVariant="primary" title="Add webhook target" action={createWebhook} submitLabel="Add" successMessage="Webhook added.">
      <label style={label}>
        <span style={span}>Endpoint URL</span>
        <input name="url" required type="url" placeholder="https://hooks.slack.com/…" style={control} />
      </label>
      <label style={label}>
        <span style={span}>Signing secret (optional)</span>
        <input name="secret" maxLength={200} placeholder="HMAC-SHA256 signs the payload" style={control} />
      </label>
    </FormDrawer>
  );

  return (
    <PageShell>
      <PageHeader title="Delivery channels" subtitle="Where playbook notifications go — in-app always, plus email and outbound webhooks." actions={addWebhook} />
      <PlaybooksNav />

      <Callout tone="info" title="How delivery works">
        In-app notifications always persist (the bell). <strong>Email</strong> is sent to each notification&rsquo;s owner when a
        delivery relay is configured and the workspace has email notifications enabled (Settings). <strong>Webhooks</strong> POST
        a signed JSON payload to every enabled target below. Email/webhook are high-risk sends and follow the automation-mode
        approval gate.
      </Callout>

      <Panel title="Webhook targets" accent="var(--section-accent)">
        {hooks.length === 0 ? (
          <EmptyState title="No webhooks yet" hint="Add a Slack-compatible incoming webhook (or any HTTPS endpoint) to receive playbook notifications." />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {hooks.map((h) => (
              <Card key={h.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, wordBreak: "break-all" }}>{h.url}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {h.secret ? "Signed" : "Unsigned"} · added {h.createdAt.toISOString().slice(0, 10)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Badge tone={h.enabled ? "ok" : "neutral"}>{h.enabled ? "Enabled" : "Disabled"}</Badge>
                  <MutationForm
                    action={toggleWebhook}
                    submitLabel={h.enabled ? "Disable" : "Enable"}
                    variant="secondary"
                    hidden={{ webhookId: h.id, enabled: h.enabled ? "" : "on" }}
                  />
                  <MutationForm action={deleteWebhook} submitLabel="Remove" variant="danger" successMessage="Webhook removed." hidden={{ webhookId: h.id }} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
