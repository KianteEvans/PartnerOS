import type { ReactNode } from "react";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { MarketplaceHero } from "@/app/marketplace/MarketplaceHero";
import { ListingLifecycleStepper } from "@/app/marketplace/ListingLifecycleStepper";
import { Badge } from "@/components/ui/Badge";
import { Table, type Column } from "@/components/ui/Table";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { MutationForm } from "@/components/ui/MutationForm";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { loadListingDetail, type ListingDimension, type ListingChangeSet } from "@/domain/marketplace/load";
import { loadAttributionAdvisor } from "@/domain/marketplace/advisor-load";
import { buildAttributionInsights, type FindingSeverity } from "@/domain/marketplace/attribution-insights";
import {
  updateListingDetails,
  updateListingVisibility,
  publishListing,
  addPricingDimension,
  linkListingToSolution,
  refreshChangeSet,
} from "@/domain/marketplace/actions";
import { loadSolutionOptions } from "@/domain/solutions/load";
import { publishReadiness, canEditListing, isInFlightChangeStatus } from "@/domain/marketplace/changeset";
import {
  PRODUCT_TYPE_LABELS,
  VISIBILITY_LABELS,
  LISTING_STATUS_LABELS,
  CHANGE_INTENT_LABELS,
  CHANGE_STATUS_LABELS,
  DIMENSION_TYPE_LABELS,
  DIMENSION_UNITS,
  VISIBILITY_OPTIONS,
  METERING_STATUS_LABELS,
  listingStatusTone,
  changeStatusTone,
  meteringStatusTone,
} from "@/domain/marketplace/catalog";
import { moneyFromCents as money } from "@/domain/format";
import { formLabel as labelStyle, formControl as control } from "@/components/ui/form-styles";

const SEVERITY_COLOR: Record<FindingSeverity, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
};

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const [listing, advisorData] = await Promise.all([
    loadListingDetail(identity, id),
    loadAttributionAdvisor(identity),
  ]);
  if (!listing) notFound();
  // This listing's slice of the attribution advisor (attributed vs billed + gaps).
  const attribution = buildAttributionInsights(advisorData).perListing.find((l) => l.listingId === id) ?? null;

  const canManage = can(identity.role, "marketplace:update");
  const canPublish = can(identity.role, "marketplace:publish");
  const editable = canManage && canEditListing(listing.status);
  const readiness = publishReadiness(listing, listing.dimensions);
  const coreChecks = [
    listing.title.trim().length > 0,
    listing.description.trim().length > 0,
    listing.dimensions.length > 0,
    listing.dimensions.every((d) => d.price >= 0),
  ];
  const readyPct = Math.round((coreChecks.filter(Boolean).length / coreChecks.length) * 100);
  const hidden = { listingId: id };
  const solutionOptions = canManage ? await loadSolutionOptions(identity) : [];

  const linkDrawer = canManage ? (
    <FormDrawer
      triggerLabel="Link solution"
      triggerVariant="secondary"
      title="Link to a Solution"
      action={linkListingToSolution}
      submitLabel="Save link"
      submitVariant="secondary"
      hidden={hidden}
    >
      <label style={labelStyle}>
        Solution
        <select name="solutionId" defaultValue={listing.solutionId ?? ""} style={control}>
          <option value="">— None —</option>
          {solutionOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      </label>
      <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
        Linking ties this Marketplace listing to a Specialization Solution for renewal + reporting.
      </p>
    </FormDrawer>
  ) : null;

  const dimColumns: ReadonlyArray<Column<ListingDimension>> = [
    { key: "name", header: "Dimension", render: (d) => d.name },
    { key: "api", header: "API name", render: (d) => <code style={{ fontSize: 12 }}>{d.apiName}</code> },
    { key: "type", header: "Type", render: (d) => DIMENSION_TYPE_LABELS[d.dimensionType] },
    { key: "unit", header: "Unit", render: (d) => d.unit || "—" },
    { key: "price", header: "Price", align: "right", render: (d) => `${money(d.price)}${d.unit ? ` / ${d.unit}` : ""}` },
  ];

  const changeColumns: ReadonlyArray<Column<ListingChangeSet>> = [
    { key: "intent", header: "Change", render: (c) => CHANGE_INTENT_LABELS[c.intent] },
    { key: "summary", header: "Detail", render: (c) => c.summary },
    {
      key: "status",
      header: "Status",
      render: (c) => (
        <span title={c.error || ""}>
          <Badge tone={changeStatusTone(c.status)}>{CHANGE_STATUS_LABELS[c.status]}</Badge>
        </span>
      ),
    },
    { key: "when", header: "When", align: "right", render: (c) => c.createdAt.toISOString().slice(0, 10) },
    {
      key: "refresh",
      header: "",
      align: "right",
      render: (c) =>
        canManage && isInFlightChangeStatus(c.status) ? (
          <MutationForm
            action={refreshChangeSet}
            submitLabel="Refresh"
            variant="secondary"
            hidden={{ changeSetRowId: c.id, changeSetId: c.changeSetId, listingId: id }}
          />
        ) : null,
    },
  ];

  const addDimensionDrawer = editable ? (
    <FormDrawer
      triggerLabel="Add dimension"
      triggerVariant="secondary"
      title="Add a pricing dimension"
      action={addPricingDimension}
      submitLabel="Add dimension"
      hidden={hidden}
    >
      <label style={labelStyle}>
        Name
        <input name="name" required maxLength={120} style={control} placeholder="Per user / month" />
      </label>
      <label style={labelStyle}>
        API name (optional)
        <input name="apiName" maxLength={120} style={control} placeholder="users" />
      </label>
      <label style={labelStyle}>
        Type
        <select name="dimensionType" defaultValue="usage" style={control}>
          <option value="usage">Usage</option>
          <option value="contract">Contract</option>
        </select>
      </label>
      <label style={labelStyle}>
        Unit
        <select name="unit" defaultValue="Users" style={control}>
          {DIMENSION_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Price (USD per unit)
        <input name="price" type="number" min="0" step="0.01" required style={control} placeholder="50.00" />
      </label>
    </FormDrawer>
  ) : null;

  return (
    <PageShell width={920}>
      <PageHeader
        breadcrumbs={[
          { href: "/marketplace", label: "Marketplace" },
          { label: listing.title },
        ]}
        title={listing.title}
        subtitle={`${PRODUCT_TYPE_LABELS[listing.productType]} · ${VISIBILITY_LABELS[listing.visibility]}`}
        actions={
          canManage ? (
            <div style={{ display: "flex", gap: 8 }}>
              {editable && (
              <>
              <FormDrawer
                triggerLabel="Edit details"
                triggerVariant="secondary"
                title="Edit listing details"
                action={updateListingDetails}
                submitVariant="secondary"
                hidden={hidden}
              >
                <label style={labelStyle}>
                  Title
                  <input name="title" defaultValue={listing.title} maxLength={200} style={control} />
                </label>
                <label style={labelStyle}>
                  Description
                  <textarea name="description" defaultValue={listing.description} rows={4} maxLength={4000} style={control} />
                </label>
              </FormDrawer>
              <FormDrawer
                triggerLabel="Visibility"
                triggerVariant="secondary"
                title="Update visibility"
                action={updateListingVisibility}
                submitVariant="secondary"
                hidden={hidden}
              >
                <label style={labelStyle}>
                  Visibility
                  <select name="visibility" defaultValue={listing.visibility} style={control}>
                    {VISIBILITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </FormDrawer>
              </>
              )}
              {linkDrawer}
            </div>
          ) : undefined
        }
      />

      <MarketplaceHero
        ring={{ value: readyPct, caption: "publish ready" }}
        cards={[
          { label: "Status", value: LISTING_STATUS_LABELS[listing.status], tone: listingStatusTone(listing.status) },
          { label: "Pricing dimensions", value: String(listing.dimensions.length) },
          { label: "Product code", value: listing.productCode || "—" },
          {
            label: "Last synced",
            value: listing.lastSyncedAt ? listing.lastSyncedAt.toISOString().slice(0, 10) : "Never",
          },
        ]}
      />

      {/* Task-centric grouping: everything needed to GET the listing live first… */}
      <h2 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted)", margin: "6px 0 -6px" }}>
        Setup &amp; publishing
      </h2>
      <Panel title="Listing lifecycle" accent="var(--section-accent)">
        <ListingLifecycleStepper status={listing.status} />
        {listing.status === "changing" && (
          <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
            A Catalog change set is being applied on AWS — editing is paused until it resolves.
          </p>
        )}
      </Panel>

      {listing.solutionTitle && (
        <Callout tone="neutral" title="Linked solution">
          This listing is linked to the <strong>{listing.solutionTitle}</strong> solution.
        </Callout>
      )}

      <Panel
        title="Publish"
        accent={readiness.ready ? "ok" : "warn"}
        actions={
          canPublish && listing.status !== "published" ? (
            <MutationForm
              action={publishListing}
              submitLabel="Publish to AWS"
              successMessage="Publish change set started."
              hidden={hidden}
            />
          ) : undefined
        }
      >
        {listing.status === "published" ? (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>This listing is published on AWS Marketplace.</p>
        ) : readiness.ready ? (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            Ready to publish. Publishing starts a Catalog <code>ReleaseProduct</code> change set on AWS.
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", fontSize: 13 }}>
            {readiness.issues.map((iss) => (
              <li key={iss}>{iss}</li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Pricing dimensions" accent="var(--section-accent)" actions={addDimensionDrawer}>
        {listing.dimensions.length === 0 ? (
          <EmptyState title="No pricing dimensions" hint="Add at least one priced dimension before publishing." action={addDimensionDrawer} />
        ) : (
          <Table columns={dimColumns} rows={listing.dimensions} rowKey={(d) => d.id} />
        )}
      </Panel>

      {/* …then how it performs once live. */}
      <h2 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted)", margin: "10px 0 -6px" }}>
        Operations
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        <Panel title="Customer entitlements" accent="var(--section-accent)">
          <Table
            rows={listing.entitlements}
            rowKey={(e) => e.id}
            empty="No entitlements for this listing yet."
            columns={[
              { key: "customer", header: "Customer", render: (e) => e.customerIdentifier || "—" },
              { key: "dimension", header: "Dimension", render: (e) => <code>{e.dimension}</code> },
              { key: "value", header: "Value", align: "right", render: (e) => String(e.value) },
              {
                key: "expires",
                header: "Expires",
                render: (e) => <span style={{ color: "var(--muted)" }}>{e.expirationDate ?? "Perpetual"}</span>,
              },
            ]}
          />
        </Panel>

        <Panel title="Recent metering" accent="var(--section-accent)">
          <Table
            rows={listing.recentMetering}
            rowKey={(m) => m.id}
            empty="No usage submitted for this listing yet."
            columns={[
              { key: "customer", header: "Customer", render: (m) => m.customerIdentifier || "—" },
              { key: "dimension", header: "Dimension", render: (m) => <code>{m.dimension}</code> },
              { key: "qty", header: "Qty", align: "right", render: (m) => String(m.quantity) },
              {
                key: "date",
                header: "Date",
                render: (m) => (
                  <span style={{ color: "var(--muted)" }}>{m.usageTimestamp.toISOString().slice(0, 10)}</span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (m) => <Badge tone={meteringStatusTone(m.status)}>{METERING_STATUS_LABELS[m.status]}</Badge>,
              },
            ]}
          />
        </Panel>

        <Panel title="Attributed revenue" accent="var(--section-accent)">
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 24 }}>{money(listing.attributedRevenueCents)}</strong>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>to this listing</span>
            {attribution && attribution.billedCents > 0 && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                · {money(attribution.billedCents)} Marketplace-billed
              </span>
            )}
          </div>
          {attribution && (
            <div style={{ marginTop: 8 }}>
              <Badge
                tone={
                  attribution.activeMethods > 0 ? "ok" : listing.status === "published" ? "danger" : "neutral"
                }
              >
                {attribution.activeMethods}/{attribution.totalMethods} measurement methods active
              </Badge>
            </div>
          )}
          {attribution && attribution.findings.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              {attribution.findings.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12 }}>
                  <span
                    aria-hidden
                    style={{ width: 7, height: 7, borderRadius: 999, background: SEVERITY_COLOR[f.severity], flexShrink: 0 }}
                  />
                  <span style={{ color: "var(--muted)", lineHeight: 1.5 }}>
                    <strong style={{ color: "var(--text)" }}>{f.title}.</strong> {f.detail}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Configure attribution on{" "}
            <Link href="/marketplace/revenue" style={{ color: "var(--accent)" }}>
              Partner Revenue Measurement
            </Link>
            .
          </p>
        </Panel>
      </div>

      <Panel title="Change history" accent="var(--section-accent)">
        {listing.changeSets.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>No change sets yet.</p>
        ) : (
          <Table columns={changeColumns} rows={listing.changeSets} rowKey={(c) => c.id} />
        )}
      </Panel>

      <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
        AWS entity: <code>{listing.entityId}</code> &middot; <Link href="/marketplace">All listings</Link>
      </p>
    </PageShell>
  );
}
