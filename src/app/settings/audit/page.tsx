import type { ReactNode } from "react";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Table } from "@/components/ui/Table";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { BarChart } from "@/components/ui/BarChart";
import {
  AUDIT_PAGE_SIZE,
  auditQueryString,
  auditWhere,
  parseAuditFilters,
} from "@/domain/audit/query";
import {
  collectOperatorRefs,
  formatAttribution,
  operatorRefFromMetadata,
} from "@/domain/audit/attribution";
import { loadAttribution } from "@/domain/audit/attribution-load";

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

interface Row {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorUserId: string | null;
  createdAt: Date;
  metadata: unknown;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  // The audit trail is a governance surface — gate it explicitly.
  if (!can(identity.role, "audit:read")) redirect("/settings");

  const sp = await searchParams;
  const filters = parseAuditFilters(sp);
  const pageParam = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const page = Math.max(1, Number(pageParam ?? "1") || 1);

  const data = await withTenant(identity, async (tx) => {
    const where = auditWhere(identity.tenantId, filters);
    const rows = (await tx
      .select({
        id: auditLog.id,
        action: auditLog.action,
        resourceType: auditLog.resourceType,
        resourceId: auditLog.resourceId,
        actorUserId: auditLog.actorUserId,
        createdAt: auditLog.createdAt,
        metadata: auditLog.metadata,
      })
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE)) as Row[];
    const totalRows = await tx
      .select({ n: count() })
      .from(auditLog)
      .where(where);
    const total = totalRows[0]?.n ?? 0;
    const resourceTypes = await tx
      .selectDistinct({ rt: auditLog.resourceType })
      .from(auditLog)
      .where(eq(auditLog.tenantId, identity.tenantId));
    const members = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.tenantId, identity.tenantId));
    // Events-per-day over the last 30 days (honours the active filters).
    const since = new Date(Date.now() - 30 * 86_400_000);
    const perDay = await tx
      .select({ day: sql<string>`date(${auditLog.createdAt})`, n: count() })
      .from(auditLog)
      .where(and(where, gte(auditLog.createdAt, since)))
      .groupBy(sql`date(${auditLog.createdAt})`)
      .orderBy(sql`date(${auditLog.createdAt})`);
    return {
      rows,
      total,
      resourceTypes: resourceTypes.map((r) => r.rt).sort(),
      members,
      perDay,
    };
  });

  const emailById = new Map(data.members.map((m) => [m.id, m.email]));
  // Resolve agency act-as attribution (cross-tenant) for any delegated rows on
  // this page, so the trail shows WHICH agency operator acted, not just the
  // synthetic service user.
  const attribution = await loadAttribution(collectOperatorRefs(data.rows.map((r) => r.metadata)));
  const totalPages = Math.max(1, Math.ceil(data.total / AUDIT_PAGE_SIZE));
  const qs = auditQueryString(filters);
  const pageHref = (p: number): string => `/settings/audit?${qs ? `${qs}&` : ""}page=${p}`;

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ href: "/", label: "Home" }, { href: "/settings", label: "Settings" }, { label: "Audit log" }]}
        title="Audit log"
        subtitle={`${data.total.toLocaleString()} event${data.total === 1 ? "" : "s"} · immutable, tenant-scoped`}
        actions={
          <a
            href={`/settings/audit/export${qs ? `?${qs}` : ""}`}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              fontSize: 13,
              textDecoration: "none",
              border: "1px solid var(--border)",
              color: "var(--accent)",
            }}
          >
            Export CSV
          </a>
        }
      />

      <MetricStrip min={150}>
        <MetricCard label="Total events" value={data.total.toLocaleString()} />
        <MetricCard label="Resource types" value={String(data.resourceTypes.length)} />
        <MetricCard label="Team members" value={String(data.members.length)} />
      </MetricStrip>

      {data.perDay.length > 0 && (
        <Panel title="Activity over time (30 days)">
          <BarChart
            formatValue={(n) => String(n)}
            data={data.perDay.map((d) => ({ label: String(d.day).slice(5), value: Number(d.n), color: "var(--accent-2)" }))}
          />
        </Panel>
      )}

      <Panel title="Filters">
        <form method="get" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <label style={labelStyle}>
            <span style={spanStyle}>Actor</span>
            <select name="actor" defaultValue={filters.actor} style={controlStyle}>
              <option value="">Any user</option>
              {data.members.map((m) => (
                <option key={m.id} value={m.id}>{m.email}</option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>Resource</span>
            <select name="resource" defaultValue={filters.resource} style={controlStyle}>
              <option value="">Any resource</option>
              {data.resourceTypes.map((rt) => (
                <option key={rt} value={rt}>{rt}</option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>Action contains</span>
            <input name="action" defaultValue={filters.action} maxLength={100} placeholder="e.g. approve" style={controlStyle} />
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>From</span>
            <input type="date" name="from" defaultValue={filters.from} style={controlStyle} />
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>To</span>
            <input type="date" name="to" defaultValue={filters.to} style={controlStyle} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              style={{
                background: "var(--accent)",
                color: "var(--accent-ink)",
                border: "1px solid var(--accent)",
                borderRadius: 8,
                padding: "8px 16px",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Filter
            </button>
            <a
              href="/settings/audit"
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 13,
                color: "var(--text)",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Clear
            </a>
          </div>
        </form>
      </Panel>

      <Panel>
        <Table
          rows={data.rows}
          rowKey={(r) => r.id}
          empty="No audit events match these filters."
          columns={[
            {
              key: "time",
              header: "Time (UTC)",
              render: (r) => r.createdAt.toISOString().slice(0, 19).replace("T", " "),
            },
            {
              key: "actor",
              header: "Actor",
              render: (r) => {
                const base = r.actorUserId ? emailById.get(r.actorUserId) ?? "—" : "system";
                const ref = operatorRefFromMetadata(r.metadata);
                if (!ref) return base;
                const label = formatAttribution(
                  attribution.operatorEmailById.get(ref.operatorId),
                  attribution.agencyNameById.get(ref.agencyId),
                );
                return (
                  <div style={{ display: "grid", gap: 2 }}>
                    <span>{base}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>· {label}</span>
                  </div>
                );
              },
            },
            {
              key: "action",
              header: "Action",
              render: (r) => <strong style={{ fontWeight: 600 }}>{r.action}</strong>,
            },
            { key: "resource", header: "Resource", render: (r) => r.resourceType },
            {
              key: "resourceId",
              header: "Resource ID",
              render: (r) =>
                r.resourceId ? (
                  <span style={{ color: "var(--muted)", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                    {r.resourceId.slice(0, 8)}
                  </span>
                ) : (
                  "—"
                ),
            },
          ]}
        />

        {data.total > AUDIT_PAGE_SIZE && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, fontSize: 13, color: "var(--muted)" }}>
            <span>Page {page} of {totalPages}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <PageLink href={pageHref(page - 1)} disabled={page <= 1}>← Prev</PageLink>
              <PageLink href={pageHref(page + 1)} disabled={page >= totalPages}>Next →</PageLink>
            </div>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: ReactNode;
}): ReactNode {
  const style = {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    fontSize: 13,
    textDecoration: "none",
  } as const;
  if (disabled) {
    return <span style={{ ...style, color: "var(--muted)", opacity: 0.5 }}>{children}</span>;
  }
  return <a href={href} style={{ ...style, color: "var(--text)" }}>{children}</a>;
}
