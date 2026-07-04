import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Table, type Column } from "@/components/ui/Table";
import { Callout } from "@/components/ui/Callout";
import { MutationForm } from "@/components/ui/MutationForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchForm } from "@/components/ui/SearchForm";
import { Pagination } from "@/components/ui/Pagination";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { MarketplaceNav } from "@/app/marketplace/MarketplaceNav";
import { MarketplaceHero } from "@/app/marketplace/MarketplaceHero";
import { loadEntitlements, loadMarketplaceTrends, type EntitlementItem } from "@/domain/marketplace/load";
import {
  entitlementStatus,
  entitlementSummary,
  coverageByDimension,
  type EntitlementStatus,
} from "@/domain/marketplace/entitlements";
import { syncEntitlements } from "@/domain/marketplace/actions";
import { parseListParams, listHref, pageCount } from "@/domain/list";
import { tableView } from "@/domain/marketplace/table-view";

const STATUS_TONE: Record<EntitlementStatus, Tone> = { active: "ok", expiring: "warn", expired: "danger" };
const STATUS_LABEL: Record<EntitlementStatus, string> = { active: "Active", expiring: "Expiring", expired: "Expired" };

export default async function EntitlementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const today = new Date().toISOString().slice(0, 10);
  const params = parseListParams(await searchParams, {
    sortable: ["expires", "customer", "listing", "dimension", "value", "status"],
    defaultSort: "expires",
    defaultDir: "asc",
  });

  const [data, trends] = await Promise.all([loadEntitlements(identity), loadMarketplaceTrends(identity, today)]);
  const canSync = can(identity.role, "marketplace:sync");
  const summary = entitlementSummary(data.items, today);
  const coverage = coverageByDimension(
    data.items,
    new Map(Object.entries(data.meteredByDimension)),
    today,
  ).filter((c) => c.overage);

  const syncForm = canSync ? (
    <MutationForm action={syncEntitlements} submitLabel="Sync from AWS" successMessage="Entitlements synced." variant="secondary" />
  ) : null;

  const statusOrder: Record<EntitlementStatus, number> = { expired: 0, expiring: 1, active: 2 };
  const view = tableView(data.items, params, {
    search: (e) => `${e.customerIdentifier} ${e.listingTitle ?? ""} ${e.dimension}`,
    comparators: {
      expires: (a, b) => (a.expirationDate ?? "9999-12-31").localeCompare(b.expirationDate ?? "9999-12-31"),
      customer: (a, b) => a.customerIdentifier.localeCompare(b.customerIdentifier),
      listing: (a, b) => (a.listingTitle ?? "").localeCompare(b.listingTitle ?? ""),
      dimension: (a, b) => a.dimension.localeCompare(b.dimension),
      value: (a, b) => a.value - b.value,
      status: (a, b) =>
        statusOrder[entitlementStatus(a.expirationDate, today)] - statusOrder[entitlementStatus(b.expirationDate, today)],
    },
  });
  const totalPages = pageCount(view.total, params.pageSize);
  const sortState = {
    sort: params.sort,
    dir: params.dir,
    href: (key: string) =>
      listHref("/marketplace/entitlements", {
        q: params.q,
        sort: key,
        dir: key === params.sort && params.dir === "asc" ? "desc" : "asc",
      }),
  };

  const columns: ReadonlyArray<Column<EntitlementItem>> = [
    { key: "customer", header: "Customer", sortKey: "customer", render: (e) => e.customerIdentifier || "—" },
    { key: "listing", header: "Listing", sortKey: "listing", render: (e) => e.listingTitle ?? "—" },
    {
      key: "dimension",
      header: "Dimension",
      sortKey: "dimension",
      render: (e) => <code style={{ fontSize: 12 }}>{e.dimension}</code>,
    },
    { key: "value", header: "Value", align: "right", sortKey: "value", render: (e) => String(e.value) },
    { key: "expires", header: "Expires", sortKey: "expires", render: (e) => e.expirationDate ?? "Perpetual" },
    {
      key: "status",
      header: "Status",
      sortKey: "status",
      render: (e) => {
        const s = entitlementStatus(e.expirationDate, today);
        return <Badge tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</Badge>;
      },
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Entitlements"
        subtitle="Customer rights granted by AWS Marketplace (GetEntitlements). Read-only; AWS is the source of truth."
        actions={syncForm ?? undefined}
      />
      <MarketplaceNav />

      <MarketplaceHero
        ring={{ value: summary.total ? Math.round((summary.active / summary.total) * 100) : 0, caption: "active" }}
        cards={[
          { label: "Entitlements", value: String(summary.total) },
          { label: "Active", value: String(summary.active), tone: "ok", trend: trends.activeEntitlements },
          { label: "Expiring (30d)", value: String(summary.expiring), tone: summary.expiring > 0 ? "warn" : "neutral" },
          { label: "Expired", value: String(summary.expired), tone: summary.expired > 0 ? "danger" : "neutral" },
        ]}
      />

      {(summary.expiring > 0 || summary.expired > 0) && (
        <Callout
          tone={summary.expired > 0 ? "danger" : "warn"}
          title="Entitlements need renewal follow-up"
        >
          {summary.expired > 0 && <div>{summary.expired} expired — reach out to renew before churn.</div>}
          {summary.expiring > 0 && (
            <div>{summary.expiring} expiring within 30 days — confirm renewal with the customer.</div>
          )}
        </Callout>
      )}

      {coverage.length > 0 && (
        <Callout tone="warn" title="Usage exceeds entitlement">
          {coverage.map((c) => (
            <div key={c.dimension}>
              <code>{c.dimension}</code>: metered {c.metered} vs entitled {c.entitled} — follow up on overage.
            </div>
          ))}
        </Callout>
      )}

      <SavedViewsBar listKey="marketplace-entitlements" current={{ q: params.q, sort: params.sort, dir: params.dir }} />

      <Panel
        title={`Entitlements (${view.total})`}
        accent="var(--section-accent)"
        actions={<SearchForm q={params.q} placeholder="Search entitlements…" hidden={{ sort: params.sort, dir: params.dir }} />}
      >
        <Table
          columns={columns}
          rows={view.rows}
          rowKey={(e) => e.id}
          sort={sortState}
          rowStyle={(e) => {
            const s = entitlementStatus(e.expirationDate, today);
            if (s === "expired") return { background: "color-mix(in srgb, var(--danger) 8%, transparent)" };
            if (s === "expiring") return { background: "color-mix(in srgb, var(--warn) 8%, transparent)" };
            return undefined;
          }}
          empty={
            data.items.length === 0 ? (
              <EmptyState
                title="No entitlements"
                hint="Entitlements appear here once customers subscribe on AWS Marketplace. Sync to pull them."
                action={syncForm}
              />
            ) : params.q ? (
              `No entitlements match “${params.q}”.`
            ) : (
              "No entitlements."
            )
          }
        />
        <Pagination
          page={params.page}
          totalPages={totalPages}
          total={view.total}
          prevHref={listHref("/marketplace/entitlements", { q: params.q, sort: params.sort, dir: params.dir, page: params.page - 1 })}
          nextHref={listHref("/marketplace/entitlements", { q: params.q, sort: params.sort, dir: params.dir, page: params.page + 1 })}
        />
      </Panel>
    </PageShell>
  );
}
