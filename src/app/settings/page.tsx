import type { ReactNode } from "react";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { workspaceSettings, connectors, users, auditLog, invitations, ssoConfig, tenants, awsConnection } from "@/db/schema";
import { can } from "@/authz/permissions";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { isIncluded, PACKAGE_TIERS, PACKAGE_META } from "@/domain/packaging/catalog";
import {
  getPackagePreview,
  effectivePackageTier,
  currentWorkspacePlan,
} from "@/domain/packaging/preview";
import { setPackagePreview } from "@/domain/packaging/preview-actions";
import { RingGauge } from "@/components/ui/RingGauge";
import { BarChart } from "@/components/ui/BarChart";
import { ActivityList } from "@/components/ui/ActivityList";
import { MutationForm } from "@/components/ui/MutationForm";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { ScimPanel } from "@/components/ui/ScimPanel";
import { SamlConfigPanel } from "@/components/ui/SamlConfigPanel";
import { AwsConnectionPanel } from "@/components/ui/AwsConnectionPanel";
import { MarketplaceConnectionPanel } from "@/components/ui/MarketplaceConnectionPanel";
import {
  updateWorkspaceSettings,
  updateUserRole,
  setUserStatus,
  revokeUserSessions,
  eraseUser,
  inviteUser,
  revokeInvitation,
  configureConnector,
  setConnectorStatus,
  syncConnector,
} from "@/domain/settings/actions";
import { setBenchmarkParticipation } from "@/domain/benchmarks/actions";
import { approveLink, rejectLink } from "@/domain/portfolio/actions";
import { loadIncomingLinkRequests, loadAgencyRoster } from "@/domain/portfolio/link-load";
import { loadTenantMeta } from "@/auth/agency";
import {
  AUTOMATION_MODES,
  AUTOMATION_MODE_LABELS,
  AUTOMATION_MODE_DESCRIPTIONS,
  capabilityMatrix,
  DECISION_LABELS,
  type AutomationMode,
} from "@/domain/settings/automation";
import {
  CONNECTOR_CATALOG,
  connectorHealth,
  HEALTH_LABELS,
} from "@/domain/settings/connectors";
import { workspaceReadiness } from "@/domain/settings/readiness";

const labelStyle = { display: "grid", gap: 4, fontSize: 13 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 8px",
  color: "var(--text)",
  fontSize: 13,
} as const;
const ROLES = ["owner", "admin", "manager", "member", "viewer"] as const;

type SectionKey = "general" | "members" | "integrations" | "readiness" | "data" | "activity";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const canManage = can(identity.role, "settings:manage");
  const canUsers = can(identity.role, "user:update");
  const canAudit = can(identity.role, "audit:read");
  const canErase = can(identity.role, "user:erase");
  const today = new Date().toISOString().slice(0, 10);

  // Agency / portfolio (Bet C): incoming manage-requests (approver side) + this
  // workspace's own agency roster when it is itself an agency.
  const incomingLinks = await loadIncomingLinkRequests(identity);
  const agencyMeta = await loadTenantMeta(identity.tenantId);
  const roster = agencyMeta?.isAgency ? await loadAgencyRoster(identity) : null;

  const data = await withTenant(identity, async (tx) => {
    const [settings] = await tx.select().from(workspaceSettings).where(eq(workspaceSettings.tenantId, identity.tenantId));
    const conns = await tx.select().from(connectors).where(eq(connectors.tenantId, identity.tenantId));
    const members = await tx.select({ id: users.id, email: users.email, role: users.role, status: users.status }).from(users).where(eq(users.tenantId, identity.tenantId));
    const invites = canUsers
      ? await tx
          .select({ id: invitations.id, email: invitations.email, role: invitations.role, createdAt: invitations.createdAt })
          .from(invitations)
          .where(and(eq(invitations.tenantId, identity.tenantId), eq(invitations.status, "pending")))
          .orderBy(desc(invitations.createdAt))
      : [];
    const activity = canAudit
      ? await tx.select({ action: auditLog.action, resourceType: auditLog.resourceType, actorUserId: auditLog.actorUserId, createdAt: auditLog.createdAt }).from(auditLog).where(eq(auditLog.tenantId, identity.tenantId)).orderBy(desc(auditLog.createdAt)).limit(10)
      : [];
    const [sso] = await tx
      .select({
        scimEnabled: ssoConfig.scimEnabled,
        samlEnabled: ssoConfig.samlEnabled,
        samlIdpEntityId: ssoConfig.samlIdpEntityId,
        samlIdpSsoUrl: ssoConfig.samlIdpSsoUrl,
        samlIdpCert: ssoConfig.samlIdpCert,
      })
      .from(ssoConfig)
      .where(eq(ssoConfig.tenantId, identity.tenantId));
    const [tenant] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, identity.tenantId));
    const [aws] = await tx.select().from(awsConnection).where(eq(awsConnection.tenantId, identity.tenantId));
    return { settings, conns, members, invites, activity, sso, tenant, aws };
  });

  const reqHeaders = await headers();
  const host = reqHeaders.get("host") ?? "localhost:3000";
  const origin = `${reqHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  const scimBase = `${origin}/api/scim/v2`;
  const samlSlug = data.tenant?.slug ?? "";
  const samlUrls = {
    login: `${origin}/api/auth/saml/${samlSlug}/login`,
    acs: `${origin}/api/auth/saml/${samlSlug}/acs`,
    metadata: `${origin}/api/auth/saml/${samlSlug}/metadata`,
  };

  const mode = (data.settings?.automationMode ?? "recommend_only") as AutomationMode;
  const connByKind = new Map(data.conns.map((c) => [c.kind, c]));
  const emailById = new Map(data.members.map((m) => [m.id, m.email]));
  const connLikes = data.conns.map((c) => ({
    status: c.status,
    lastSyncDate: c.lastSyncAt ? c.lastSyncAt.toISOString().slice(0, 10) : null,
  }));
  const readiness = workspaceReadiness(
    data.settings ? { displayName: data.settings.displayName, automationMode: mode } : null,
    connLikes,
    today,
  );
  // Governance posture: how many capabilities fall into each decision bucket.
  const decisionCounts: Record<string, number> = { auto: 0, recommend: 0, blocked: 0 };
  for (const { decision } of capabilityMatrix(mode)) {
    decisionCounts[decision] = (decisionCounts[decision] ?? 0) + 1;
  }

  // Package preview: the governance suite (audit/activity, data & privacy/DSAR,
  // SSO/SCIM, session revocation) is an Enterprise-package feature. Core settings
  // stay open in every tier.
  // Feature gating uses the EFFECTIVE tier (real plan clamped by any preview);
  // the panel below surfaces the real plan and the raw preview cookie separately.
  const previewCookie = await getPackagePreview();
  const realPlan = await currentWorkspacePlan();
  const effectiveTier = await effectivePackageTier();
  const governance = isIncluded(effectiveTier, "settings_governance");
  const showPlaybooks = isIncluded(effectiveTier, "playbooks");
  const autoPlaybooks = isIncluded(effectiveTier, "playbooks_auto");

  // Left-nav sections — gated by permission so a viewer never sees an empty pane.
  const sections: { key: SectionKey; label: string }[] = [
    { key: "general", label: "General" },
    { key: "members", label: "Members" },
    { key: "integrations", label: "Integrations" },
    { key: "readiness", label: "Readiness" },
    ...(canManage && governance ? ([{ key: "data", label: "Data & privacy" }] as const) : []),
    ...(canAudit && governance ? ([{ key: "activity", label: "Activity" }] as const) : []),
  ];
  const sp = await searchParams;
  const active: SectionKey = sections.some((s) => s.key === sp.section)
    ? (sp.section as SectionKey)
    : "general";

  return (
    <PageShell>
      <PageHeader title="Settings & Integrations" />

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Section sub-nav */}
        <nav
          style={{
            flex: "0 0 200px",
            display: "grid",
            gap: 2,
            position: "sticky",
            top: 16,
          }}
        >
          {sections.map((s) => {
            const isActive = s.key === active;
            return (
              <Link
                key={s.key}
                href={`/settings?section=${s.key}`}
                style={{
                  display: "block",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 14,
                  textDecoration: "none",
                  borderLeft: `3px solid ${isActive ? "var(--accent)" : "transparent"}`,
                  background: isActive ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                  color: isActive ? "var(--accent)" : "var(--text)",
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>

        {/* Active section content */}
        <div style={{ flex: 1, minWidth: 280, display: "grid", gap: 16 }}>
          {!canManage && (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>You can view settings; an owner or admin makes changes.</p>
          )}

          {active === "general" && (
            <>
              {canManage && (
                <Panel title="Package preview" accent="var(--accent-2)">
                  <p style={{ fontSize: 13, marginTop: 0, marginBottom: 8 }}>
                    This workspace is on the{" "}
                    <strong style={{ color: "var(--accent-2)" }}>{PACKAGE_META[realPlan].label}</strong>{" "}
                    package{realPlan === "enterprise" ? " (full platform)" : ""}. Your agency sets this.
                  </p>
                  <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13 }}>
                    Preview the platform as a lower package would see it — changes only what
                    <strong> you</strong> see, expires after 8 hours, and can never show more than the real
                    package. Fenced sections show upgrade screens, never errors.
                  </p>
                  <MutationForm action={setPackagePreview} submitLabel="Apply preview">
                    <label style={labelStyle}>
                      <span style={spanStyle}>Preview as</span>
                      <select name="tier" defaultValue={previewCookie ?? "off"} style={controlStyle}>
                        <option value="off">Full platform (no preview)</option>
                        {PACKAGE_TIERS.map((t) => (
                          <option key={t} value={t}>{PACKAGE_META[t].label} · {PACKAGE_META[t].stage}</option>
                        ))}
                      </select>
                    </label>
                  </MutationForm>
                  {previewCookie && (
                    <p style={{ fontSize: 12.5, color: "var(--accent-2)", marginBottom: 0, marginTop: 10 }}>
                      Currently previewing <strong>{PACKAGE_META[previewCookie].label}</strong>. Choose &ldquo;Full
                      platform&rdquo; above or use the banner to exit.
                    </p>
                  )}
                </Panel>
              )}

              <Panel title="Workspace">
                {canManage ? (
                  <MutationForm action={updateWorkspaceSettings} submitLabel="Save">
                    <label style={labelStyle}>
                      <span style={spanStyle}>Display name</span>
                      <input name="displayName" maxLength={200} defaultValue={data.settings?.displayName ?? ""} style={controlStyle} />
                    </label>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
                      {showPlaybooks && (
                        <label style={labelStyle}>
                          <span style={spanStyle}>Automation mode</span>
                          <select name="automationMode" defaultValue={mode} style={controlStyle}>
                            {AUTOMATION_MODES.filter((m) => autoPlaybooks || m === "off" || m === "recommend_only").map((m) => (
                              <option key={m} value={m}>{AUTOMATION_MODE_LABELS[m]}</option>
                            ))}
                          </select>
                          {!autoPlaybooks && (
                            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                              Automatic execution modes are part of Enterprise.
                            </span>
                          )}
                        </label>
                      )}
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <input type="checkbox" name="emailNotifications" defaultChecked={data.settings?.emailNotifications ?? true} />
                        Email notifications
                      </label>
                    </div>
                  </MutationForm>
                ) : (
                  <p style={{ fontSize: 14, margin: 0 }}>
                    Name: {data.settings?.displayName || "—"} · Automation: {AUTOMATION_MODE_LABELS[mode]}
                  </p>
                )}
              </Panel>

              <Panel title="Benchmarking">
                <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>
                  Reciprocal and anonymized. When on, this workspace contributes its metrics to peer
                  cohorts (by tier and tenure) and unlocks the Benchmarks panel showing how you
                  compare. Every cohort is aggregated across at least 5 partners; no partner-level
                  data is ever shown. When off, you neither contribute nor see peers.
                </p>
                {canManage ? (
                  <MutationForm action={setBenchmarkParticipation} submitLabel="Save">
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        name="participating"
                        defaultChecked={data.settings?.benchmarkParticipation ?? false}
                      />
                      Participate in cross-partner benchmarking
                    </label>
                  </MutationForm>
                ) : (
                  <p style={{ fontSize: 14, margin: 0 }}>
                    Benchmarking: {data.settings?.benchmarkParticipation ? "On" : "Off"}
                  </p>
                )}
              </Panel>

              {incomingLinks.length > 0 && (
                <Panel title="Managed by" accent="info">
                  <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>
                    An agency has asked to manage this workspace. Approving lets their operators act
                    inside it as a delegated admin — every action they take is stamped with the agency
                    in your audit log. You can decline instead.
                  </p>
                  <div style={{ display: "grid", gap: 10 }}>
                    {incomingLinks.map((rq) => (
                      <div
                        key={rq.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                          borderTop: "1px solid var(--border)",
                          paddingTop: 10,
                        }}
                      >
                        <div style={{ fontSize: 13.5 }}>
                          <strong>{rq.agencyName}</strong>{" "}
                          <span style={{ color: "var(--muted)" }}>({rq.agencySlug})</span>
                        </div>
                        {canManage ? (
                          <div style={{ display: "flex", gap: 8 }}>
                            <MutationForm action={approveLink} submitLabel="Approve" hidden={{ requestId: rq.id }} />
                            <MutationForm action={rejectLink} submitLabel="Decline" variant="danger" hidden={{ requestId: rq.id }} />
                          </div>
                        ) : (
                          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Ask an admin to decide.</span>
                        )}
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {roster && (
                <Panel
                  title="Organization"
                  accent="info"
                  actions={
                    <Link href="/portfolio" style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                      Open portfolio →
                    </Link>
                  }
                >
                  <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13 }}>
                    This workspace is an <strong>agency</strong> managing {roster.managed.length} workspace
                    {roster.managed.length === 1 ? "" : "s"}
                    {roster.outgoing.length > 0
                      ? ` · ${roster.outgoing.length} pending request${roster.outgoing.length === 1 ? "" : "s"}`
                      : ""}
                    .
                  </p>
                  {roster.managed.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: "grid", gap: 3 }}>
                      {roster.managed.slice(0, 6).map((m) => (
                        <li key={m.id}>
                          {m.name} <span style={{ color: "var(--muted)" }}>({m.tier})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              )}

              {showPlaybooks && (
              <Panel title="Automation governance">
                <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13 }}>{AUTOMATION_MODE_DESCRIPTIONS[mode]}</p>
                <div style={{ marginBottom: 14 }}>
                  <BarChart
                    formatValue={(n) => String(n)}
                    data={[
                      { label: "Automatic", value: decisionCounts.auto ?? 0, color: "var(--accent)" },
                      { label: "Recommend", value: decisionCounts.recommend ?? 0, color: "var(--warn)" },
                      { label: "Blocked", value: decisionCounts.blocked ?? 0, color: "var(--muted)" },
                    ]}
                  />
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  {capabilityMatrix(mode).map(({ capability, decision }) => (
                    <div key={capability.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid var(--border)", paddingBottom: 3 }}>
                      <span>{capability.label} <span style={{ color: "var(--muted)", fontSize: 11 }}>({capability.risk} risk)</span></span>
                      <span style={{ color: decision === "auto" ? "var(--accent)" : decision === "blocked" ? "var(--muted)" : "var(--warn)" }}>{DECISION_LABELS[decision]}</span>
                    </div>
                  ))}
                </div>
              </Panel>
              )}
            </>
          )}

          {active === "members" && (
            <>
              <Panel title="Users & roles">
                <div style={{ display: "grid", gap: 10 }}>
                  {data.members.map((m) => (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {m.email}{m.id === identity.userId ? " (you)" : ""}
                        <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                      </span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {canUsers ? (
                          <MutationForm action={updateUserRole} submitLabel="Set role" variant="secondary" hidden={{ userId: m.id }}>
                            <select name="role" defaultValue={m.role} style={controlStyle}>
                              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </MutationForm>
                        ) : (
                          <span style={{ color: "var(--muted)", fontSize: 13, textTransform: "capitalize" }}>{m.role}</span>
                        )}
                        {canUsers && governance && (
                          <MutationForm
                            action={revokeUserSessions}
                            submitLabel="Revoke sessions"
                            successMessage="Sessions revoked."
                            variant="secondary"
                            hidden={{ userId: m.id }}
                          />
                        )}
                        {canUsers && m.id !== identity.userId && (
                          <MutationForm
                            action={setUserStatus}
                            submitLabel={m.status === "active" ? "Deactivate" : "Reactivate"}
                            variant={m.status === "active" ? "danger" : "secondary"}
                            hidden={{ userId: m.id, status: m.status === "active" ? "disabled" : "active" }}
                          />
                        )}
                        {canManage && governance && (
                          <a
                            href={`/settings/data-export/subject/${m.id}`}
                            title={`Export everything held about ${m.email} (DSAR / subject access request)`}
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              textDecoration: "none",
                              color: "var(--accent)",
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              padding: "6px 12px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Export data
                          </a>
                        )}
                        {canErase && governance && m.status === "disabled" && m.id !== identity.userId && (
                          <FormDrawer
                            triggerLabel="Erase…"
                            triggerVariant="danger"
                            title="Erase user data"
                            action={eraseUser}
                            submitLabel="Erase permanently"
                            successMessage="User data erased."
                            submitVariant="danger"
                            hidden={{ userId: m.id }}
                          >
                            <p style={{ margin: 0, fontSize: 13 }}>
                              Permanently anonymizes <strong>{m.email}</strong>: their email and identity
                              are scrubbed and they can never sign in again. The audit trail and
                              work-product attribution are kept, but de-identified.
                            </p>
                            <p style={{ margin: 0, fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>
                              This cannot be undone.
                            </p>
                          </FormDrawer>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              {canUsers && (
                <Panel title="Invitations">
                  <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13 }}>
                    Invite a teammate by email. They join this workspace with the chosen role
                    the first time they sign in with that address.
                  </p>
                  <MutationForm action={inviteUser} submitLabel="Send invite" successMessage="Invitation sent.">
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
                      <label style={{ ...labelStyle, flex: "1 1 240px" }}>
                        <span style={spanStyle}>Email</span>
                        <input name="email" type="email" required maxLength={200} placeholder="teammate@company.com" style={controlStyle} />
                      </label>
                      <label style={labelStyle}>
                        <span style={spanStyle}>Role</span>
                        <select name="role" defaultValue="member" style={controlStyle}>
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </label>
                    </div>
                  </MutationForm>

                  <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
                    {data.invites.length === 0 ? (
                      <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>No pending invitations.</p>
                    ) : (
                      data.invites.map((inv) => (
                        <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
                          <span style={{ fontSize: 14, display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            {inv.email}
                            <Badge tone="info">{inv.role}</Badge>
                            <span style={{ color: "var(--muted)", fontSize: 12 }}>invited {inv.createdAt.toISOString().slice(0, 10)}</span>
                          </span>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            {/* inviteUserOp upserts pending invites, so re-posting = resend the email. */}
                            <MutationForm action={inviteUser} submitLabel="Resend" variant="secondary" hidden={{ email: inv.email, role: inv.role }} />
                            <MutationForm action={revokeInvitation} submitLabel="Revoke" variant="danger" hidden={{ invitationId: inv.id }} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Panel>
              )}
            </>
          )}

          {active === "integrations" && canManage && !governance && (
            <Panel title="Single sign-on & provisioning">
              <Callout tone="info" title="SSO & SCIM are part of Enterprise">
                SAML single sign-on and SCIM identity provisioning ship with the Enterprise package —
                the tier where IT owns identity. Every other integration below stays available.
              </Callout>
            </Panel>
          )}

          {active === "integrations" && canManage && governance && (
            <Panel title="Identity provisioning (SCIM)">
              <ScimPanel enabled={data.sso?.scimEnabled ?? false} baseUrl={scimBase} />
            </Panel>
          )}

          {active === "integrations" && canManage && governance && (
            <Panel title="SAML single sign-on">
              <SamlConfigPanel
                config={{
                  enabled: data.sso?.samlEnabled ?? false,
                  idpEntityId: data.sso?.samlIdpEntityId ?? null,
                  idpSsoUrl: data.sso?.samlIdpSsoUrl ?? null,
                  idpCert: data.sso?.samlIdpCert ?? null,
                }}
                urls={samlUrls}
              />
            </Panel>
          )}

          {active === "integrations" && canManage && (
            <Panel title="AWS Partner Central">
              <AwsConnectionPanel
                config={{
                  roleArn: data.aws?.roleArn ?? "",
                  externalId: data.aws?.externalId ?? "",
                  region: data.aws?.region ?? "us-east-1",
                  catalog: data.aws?.catalog ?? "Sandbox",
                  enabled: data.aws?.enabled ?? false,
                  enrichTeam: data.aws?.enrichTeam ?? false,
                  status: data.aws?.status ?? "not_configured",
                  lastError: data.aws?.lastError ?? null,
                }}
              />
            </Panel>
          )}

          {active === "integrations" && canManage && (
            <Panel title="AWS Marketplace">
              <MarketplaceConnectionPanel
                config={{
                  roleArn: data.aws?.roleArn ?? "",
                  externalId: data.aws?.externalId ?? "",
                  region: data.aws?.region ?? "us-east-1",
                  sellerId: data.aws?.sellerId ?? "",
                  marketplaceEnabled: data.aws?.marketplaceEnabled ?? false,
                  marketplaceStatus: data.aws?.marketplaceStatus ?? "not_configured",
                  marketplaceLastError: data.aws?.marketplaceLastError ?? null,
                }}
              />
            </Panel>
          )}

          {active === "integrations" && (
            <Panel title="Integrations">
              <div style={{ display: "grid", gap: 14 }}>
                {CONNECTOR_CATALOG.map((cat) => {
                  const c = connByKind.get(cat.kind);
                  const health = connectorHealth(
                    { status: c?.status ?? "not_configured", lastSyncDate: c?.lastSyncAt ? c.lastSyncAt.toISOString().slice(0, 10) : null },
                    today,
                  );
                  return (
                    <Card key={cat.kind}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <strong style={{ fontSize: 14 }}>{cat.label}</strong>
                        <Badge tone={statusTone(health)}>{HEALTH_LABELS[health]}</Badge>
                      </div>
                      <p style={{ color: "var(--muted)", fontSize: 13, margin: "4px 0 10px" }}>
                        {cat.description}
                        {c?.lastSyncAt ? ` · last sync ${c.lastSyncAt.toISOString().slice(0, 10)}` : ""}
                      </p>
                      {canManage && (
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
                          <MutationForm action={configureConnector} submitLabel={c ? "Update" : "Configure"} variant="secondary" hidden={{ kind: cat.kind }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <label style={labelStyle}><span style={spanStyle}>Endpoint</span><input name="endpoint" maxLength={500} defaultValue={c?.endpoint ?? ""} style={controlStyle} /></label>
                              <label style={labelStyle}><span style={spanStyle}>Auth mode</span><input name="authMode" maxLength={100} defaultValue={c?.authMode ?? ""} placeholder="oauth / api_key" style={controlStyle} /></label>
                            </div>
                          </MutationForm>
                          {c && c.status !== "not_configured" && (
                            <div style={{ display: "flex", gap: 8 }}>
                              <MutationForm action={syncConnector} submitLabel="Test / sync" variant="secondary" hidden={{ kind: cat.kind }} />
                              <MutationForm action={setConnectorStatus} submitLabel={c.status === "disabled" ? "Enable" : "Disable"} variant={c.status === "disabled" ? "secondary" : "danger"} hidden={{ kind: cat.kind, status: c.status === "disabled" ? "configured" : "disabled" }} />
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </Panel>
          )}

          {active === "readiness" && (
            <Panel title="Workspace readiness">
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
                <RingGauge value={readiness.percent} color={readiness.launchReady ? "var(--ok)" : "var(--warn)"} caption="ready" size={104} />
                <p style={{ color: readiness.launchReady ? "var(--ok)" : "var(--warn)", fontSize: 13, margin: 0, fontWeight: 600, minWidth: 180, flex: 1 }}>
                  {readiness.launchReady ? "Launch-ready: all critical controls satisfied." : "Critical controls incomplete."}
                </p>
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                {readiness.checks.map((c) => (
                  <div key={c.key} style={{ fontSize: 13 }}>
                    <span style={{ color: c.ok ? "var(--accent)" : "var(--danger)" }}>{c.ok ? "✓" : "✗"}</span> {c.label}
                    {c.critical ? <span style={{ color: "var(--muted)", fontSize: 11 }}> · critical</span> : ""}
                  </div>
                ))}
              </div>
              {(() => {
                const next = readiness.checks.find((c) => !c.ok);
                if (!next) return null;
                const href =
                  next.key === "connector_live" ? "/settings?section=integrations" : "/settings?section=general";
                return (
                  <div style={{ marginTop: 14 }}>
                    <Callout tone="info" title="Recommended next step">
                      {next.label} isn&rsquo;t set yet.{" "}
                      <a href={href} style={{ color: "var(--accent)", fontWeight: 600 }}>Configure →</a>
                    </Callout>
                  </div>
                );
              })()}
            </Panel>
          )}

          {active === "data" && canManage && (
            <Panel title="Data & privacy">
              <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 13 }}>
                Export a complete copy of this workspace&rsquo;s data (all sections,
                users, and the audit trail) as a single JSON file — for portability,
                backups, or a data-subject access request.
              </p>
              <a
                href="/settings/data-export"
                style={{
                  display: "inline-block",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text)",
                  textDecoration: "none",
                }}
              >
                Export workspace data (JSON)
              </a>
              <p style={{ color: "var(--muted)", marginTop: 14, marginBottom: 0, fontSize: 12.5 }}>
                For a single person&rsquo;s data (a GDPR/CCPA subject access request), use
                <strong> Export data</strong> next to that member in the Members tab — it returns only
                their profile, invitations, audit activity, saved views, and references to the records
                they authored.
              </p>
            </Panel>
          )}

          {active === "activity" && canAudit && (
            <Panel
              title="Recent activity"
              actions={
                <a href="/settings/audit" style={{ fontSize: 13, color: "var(--accent)", textDecoration: "none" }}>
                  View full audit log →
                </a>
              }
            >
              <ActivityList
                items={data.activity.map((a) => ({
                  action: a.action,
                  resourceType: a.resourceType,
                  actor: a.actorUserId ? emailById.get(a.actorUserId) ?? "—" : "system",
                  at: a.createdAt,
                }))}
              />
            </Panel>
          )}
        </div>
      </div>
    </PageShell>
  );
}
