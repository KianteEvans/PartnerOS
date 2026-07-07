import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge, statusTone, type Tone } from "@/components/ui/Badge";
import { RingGauge } from "@/components/ui/RingGauge";
import { MetricCard } from "@/components/ui/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { loadPortfolio } from "@/domain/portfolio/load";
import { sortWorkspaces, type PortfolioSortKey } from "@/domain/portfolio/rollup";
import { createManagedWorkspace, requestLink, setCustomerPlan } from "@/domain/portfolio/actions";
import { PACKAGE_META, type PackageTier } from "@/domain/packaging/catalog";
import { can } from "@/authz/permissions";
import { money } from "@/domain/format";

const BAND_TONE: Record<string, Tone> = { strong: "ok", fair: "warn", at_risk: "danger" };
const BAND_COLOR: Record<string, string> = {
  strong: "var(--ok)",
  fair: "var(--warn)",
  at_risk: "var(--danger)",
};
// Service package -> pill tone (Essentials = quiet, Enterprise = brand accent).
const PLAN_TONE: Record<string, Tone> = { essentials: "neutral", growth: "info", enterprise: "accent" };

const labelStyle = { display: "grid", gap: 4, fontSize: 12 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  padding: "8px 10px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--border)",
  background: "var(--panel)",
  fontSize: 14,
} as const;

const SORTS: ReadonlyArray<{ key: PortfolioSortKey; label: string }> = [
  { key: "health", label: "Needs attention" },
  { key: "pipeline", label: "Pipeline" },
  { key: "name", label: "Name" },
];

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const view = await loadPortfolio(identity);
  // Only agencies have a portfolio — everyone else goes home.
  if (!view.isAgency) redirect("/");

  const sp = await searchParams;
  // A mistyped ?sort= gets a clean URL back, not a silent default under it.
  if (sp.sort !== undefined && !SORTS.some((s) => s.key === sp.sort)) redirect("/portfolio");
  const sort: PortfolioSortKey = SORTS.some((s) => s.key === sp.sort)
    ? (sp.sort as PortfolioSortKey)
    : "health";
  const workspaces = sortWorkspaces(view.workspaces, sort);
  const r = view.rollup;
  // Only owners/admins can change a customer's package; managers see it read-only.
  const canSetPlan = can(identity.role, "billing:set_plan");

  const drawers = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <FormDrawer
        triggerLabel="Add workspace"
        title="Create a managed workspace"
        action={createManagedWorkspace}
        submitLabel="Create workspace"
        successMessage="Workspace created."
      >
        <p style={{ ...spanStyle, fontSize: 13, marginTop: 0 }}>
          Provision a new workspace your agency owns from day one. You can act as it immediately.
        </p>
        <label style={labelStyle}>
          <span style={spanStyle}>Workspace name</span>
          <input name="name" maxLength={120} required style={controlStyle} placeholder="Globex Cloud" />
        </label>
        <label style={labelStyle}>
          <span style={spanStyle}>Invite their team (optional) — one email per line</span>
          <textarea
            name="inviteEmails"
            rows={3}
            style={{ ...controlStyle, resize: "vertical", fontFamily: "inherit" }}
            placeholder={"lead@newsecurity.com\nops@newsecurity.com"}
          />
        </label>
        <label style={labelStyle}>
          <span style={spanStyle}>Their role</span>
          <select name="inviteRole" defaultValue="member" style={controlStyle}>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
      </FormDrawer>
      <FormDrawer
        triggerLabel="Claim existing"
        triggerVariant="secondary"
        title="Request to manage an existing workspace"
        action={requestLink}
        submitLabel="Send request"
        successMessage="Request sent — awaiting their approval."
      >
        <p style={{ ...spanStyle, fontSize: 13, marginTop: 0 }}>
          Enter the workspace&apos;s slug. Their owner must approve before it joins your portfolio.
        </p>
        <label style={labelStyle}>
          <span style={spanStyle}>Workspace slug</span>
          <input name="slug" maxLength={80} required style={controlStyle} placeholder="acme-cloud" />
        </label>
      </FormDrawer>
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        title="Portfolio"
        subtitle={
          <>
            {view.agencyName} · managing {view.total} workspace{view.total === 1 ? "" : "s"}
          </>
        }
        actions={drawers}
      />

      {/* Rollup hero */}
      <section
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          alignItems: "center",
          background: "var(--surface-hero)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 20,
          boxShadow: "var(--shadow-md)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 130 }}>
          <RingGauge value={r.avgHealth} color="var(--accent-2)" size={110} caption="avg health" />
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 244,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
          }}
        >
          <MetricCard label="Workspaces" value={String(r.count)} sub="under management" />
          <MetricCard
            label="At risk"
            value={String(r.atRisk)}
            tone={r.atRisk > 0 ? "danger" : "neutral"}
            tint={r.atRisk > 0 ? "danger" : undefined}
            sub="health at risk"
          />
          <MetricCard label="Open pipeline" value={money(r.pipeline)} sub="across workspaces" tint="accent" />
          <MetricCard
            label="Renewals due"
            value={String(r.renewalsDue)}
            tone={r.renewalsDue > 0 ? "warn" : "neutral"}
            sub="specialization renewals"
          />
          <MetricCard label="Needs attention" value={String(r.attention)} sub="open decisions" />
        </div>
      </section>

      {view.capped ? (
        <p style={{ ...spanStyle, fontSize: 12.5, margin: 0 }}>
          Showing the first {workspaces.length} of {view.total} workspaces.
        </p>
      ) : null}

      <Panel
        title="Managed workspaces"
        actions={
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SORTS.map((s) => (
              <Link
                key={s.key}
                href={`/portfolio?sort=${s.key}`}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: "none",
                  padding: "3px 10px",
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  color: sort === s.key ? "var(--accent)" : "var(--muted)",
                  background: sort === s.key ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                }}
              >
                {s.label}
              </Link>
            ))}
          </div>
        }
      >
        {workspaces.length === 0 ? (
          <EmptyState
            title="No managed workspaces yet"
            hint="Create a workspace your agency owns, or claim an existing one by slug."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                  <th style={{ padding: "6px 10px" }}>Workspace</th>
                  <th style={{ padding: "6px 10px" }}>Package</th>
                  <th style={{ padding: "6px 10px" }}>Health</th>
                  <th style={{ padding: "6px 10px" }}>Work</th>
                  <th style={{ padding: "6px 10px" }}>Pipeline</th>
                  <th style={{ padding: "6px 10px" }}>Top risk</th>
                  <th style={{ padding: "6px 10px", textAlign: "right" }}></th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((w) => (
                  <tr key={w.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "9px 10px" }}>
                      <Link href={`/portfolio/${w.id}`} style={{ fontWeight: 600, textDecoration: "none", color: "var(--text)" }}>
                        {w.name}
                      </Link>
                      <div style={{ marginTop: 3 }}>
                        <Badge tone={statusTone(w.tier)}>{w.tier}</Badge>
                      </div>
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Badge tone={PLAN_TONE[w.plan] ?? "neutral"}>
                          {PACKAGE_META[w.plan as PackageTier]?.label ?? w.plan}
                        </Badge>
                        {canSetPlan ? (
                          <FormDrawer
                            triggerLabel="Change"
                            triggerVariant="secondary"
                            title={`Service package — ${w.name}`}
                            action={setCustomerPlan}
                            submitLabel="Save package"
                            successMessage="Package updated."
                            hidden={{ workspaceId: w.id }}
                          >
                            <p style={{ ...spanStyle, fontSize: 13, marginTop: 0 }}>
                              Scope what {w.name} can access. Deliverables above their package show as an
                              upgrade path, not an error.
                            </p>
                            <label style={labelStyle}>
                              <span style={spanStyle}>Package</span>
                              <select name="plan" defaultValue={w.plan} style={controlStyle}>
                                <option value="essentials">Essentials — Establish</option>
                                <option value="growth">Growth — Scale</option>
                                <option value="enterprise">Enterprise — Operate</option>
                              </select>
                            </label>
                          </FormDrawer>
                        ) : null}
                      </div>
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <span style={{ fontWeight: 700, color: BAND_COLOR[w.band] ?? "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                        {w.health}
                      </span>{" "}
                      <Badge tone={BAND_TONE[w.band] ?? "neutral"}>{w.band.replace("_", " ")}</Badge>
                    </td>
                    <td style={{ padding: "9px 10px", color: "var(--muted)" }}>
                      {w.openWork} open
                      {w.overdue > 0 ? <span style={{ color: "var(--danger)" }}> · {w.overdue} overdue</span> : null}
                    </td>
                    <td style={{ padding: "9px 10px", fontVariantNumeric: "tabular-nums" }}>{money(w.pipeline)}</td>
                    <td style={{ padding: "9px 10px", color: "var(--muted)", maxWidth: 220 }}>
                      {w.topRisk ? w.topRisk.title : <span style={{ opacity: 0.6 }}>—</span>}
                    </td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}>
                      <form method="post" action="/api/portfolio/switch" style={{ margin: 0, display: "inline" }}>
                        <input type="hidden" name="tenantId" value={w.id} />
                        <button
                          type="submit"
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: "var(--accent)",
                            background: "transparent",
                            border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)",
                            borderRadius: 999,
                            padding: "4px 12px",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Open →
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
