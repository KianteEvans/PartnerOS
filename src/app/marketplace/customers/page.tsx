import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Table, type Column } from "@/components/ui/Table";
import { SearchForm } from "@/components/ui/SearchForm";
import { Pagination } from "@/components/ui/Pagination";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { MarketplaceNav } from "@/app/marketplace/MarketplaceNav";
import { MarketplaceHero } from "@/app/marketplace/MarketplaceHero";
import { loadCustomers } from "@/domain/marketplace/load";
import { type CustomerRollup } from "@/domain/marketplace/customers";
import { parseListParams, listHref, pageCount } from "@/domain/list";
import { tableView } from "@/domain/marketplace/table-view";
import { moneyFromCents } from "@/domain/format";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";

const money = (cents: number): string => moneyFromCents(cents, 0);

const CUSTOMER_SORT_KEYS = ["tcv", "customer", "account", "entitlements", "agreements", "usage", "last"] as const;
const customerComparators: Record<string, (a: CustomerRollup, b: CustomerRollup) => number> = {
  tcv: (a, b) => a.tcvCents - b.tcvCents,
  customer: (a, b) => a.customerIdentifier.localeCompare(b.customerIdentifier),
  account: (a, b) => a.awsAccountId.localeCompare(b.awsAccountId),
  entitlements: (a, b) => a.activeEntitlements - b.activeEntitlements,
  agreements: (a, b) => a.agreements - b.agreements,
  usage: (a, b) => a.acceptedUsage - b.acceptedUsage,
  last: (a, b) => (a.lastUsage?.getTime() ?? 0) - (b.lastUsage?.getTime() ?? 0),
};

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("marketplace");
  if (fenced) return <PackageFence feature="marketplace" previewTier={fenced} />;
  const today = new Date().toISOString().slice(0, 10);
  const params = parseListParams(await searchParams, { sortable: [...CUSTOMER_SORT_KEYS], defaultSort: "tcv" });

  const customers = await loadCustomers(identity, today);

  const totalActiveEnt = customers.reduce((s, c) => s + c.activeEntitlements, 0);
  const totalTcv = customers.reduce((s, c) => s + c.tcvCents, 0);
  const withActive = customers.filter((c) => c.activeEntitlements > 0).length;

  const view = tableView(customers, params, {
    search: (c) => `${c.customerIdentifier} ${c.awsAccountId}`,
    comparators: customerComparators,
  });
  const totalPages = pageCount(view.total, params.pageSize);
  const sortState = {
    sort: params.sort,
    dir: params.dir,
    href: (key: string) =>
      listHref("/marketplace/customers", {
        q: params.q,
        sort: key,
        dir: key === params.sort && params.dir === "asc" ? "desc" : "asc",
      }),
  };

  const columns: ReadonlyArray<Column<CustomerRollup>> = [
    {
      key: "customer",
      header: "Customer",
      sortKey: "customer",
      render: (c) => <code style={{ fontSize: 12 }}>{c.customerIdentifier}</code>,
    },
    { key: "account", header: "AWS account", sortKey: "account", render: (c) => c.awsAccountId || "—" },
    {
      key: "entitlements",
      header: "Entitlements",
      align: "right",
      sortKey: "entitlements",
      render: (c) => `${c.activeEntitlements}/${c.entitlements}`,
    },
    { key: "agreements", header: "Agreements", align: "right", sortKey: "agreements", render: (c) => String(c.agreements) },
    { key: "tcv", header: "TCV", align: "right", sortKey: "tcv", render: (c) => money(c.tcvCents) },
    { key: "usage", header: "Metered", align: "right", sortKey: "usage", render: (c) => String(c.acceptedUsage) },
    {
      key: "last",
      header: "Last usage",
      align: "right",
      sortKey: "last",
      render: (c) => (c.lastUsage ? c.lastUsage.toISOString().slice(0, 10) : "—"),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Customers"
        subtitle="Every AWS Marketplace customer rolled up across entitlements, agreements, and metered usage."
      />
      <MarketplaceNav />

      <MarketplaceHero
        ring={{
          value: customers.length ? Math.round((withActive / customers.length) * 100) : 0,
          caption: "with active rights",
        }}
        cards={[
          { label: "Customers", value: String(customers.length) },
          { label: "Active entitlements", value: String(totalActiveEnt), tone: "ok" },
          { label: "Agreement TCV", value: money(totalTcv), tint: "accent" },
        ]}
      />

      <SavedViewsBar listKey="marketplace-customers" current={{ q: params.q, sort: params.sort, dir: params.dir }} />

      <Panel
        title={`Customers (${view.total})`}
        accent="var(--section-accent)"
        actions={<SearchForm q={params.q} placeholder="Search customers…" hidden={{ sort: params.sort, dir: params.dir }} />}
      >
        <Table
          columns={columns}
          rows={view.rows}
          rowKey={(c) => c.customerIdentifier}
          sort={sortState}
          empty={
            customers.length === 0 ? (
              <EmptyState
                title="No customers yet"
                hint="Customers appear here once they subscribe on AWS Marketplace — sync entitlements and billing to populate this view."
              />
            ) : params.q ? (
              `No customers match “${params.q}”.`
            ) : (
              "No customers."
            )
          }
        />
        <Pagination
          page={params.page}
          totalPages={totalPages}
          total={view.total}
          prevHref={listHref("/marketplace/customers", { q: params.q, sort: params.sort, dir: params.dir, page: params.page - 1 })}
          nextHref={listHref("/marketplace/customers", { q: params.q, sort: params.sort, dir: params.dir, page: params.page + 1 })}
        />
      </Panel>
    </PageShell>
  );
}
