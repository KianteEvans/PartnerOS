import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge, statusTone, type Tone } from "@/components/ui/Badge";
import { KeyValueRows } from "@/components/ui/KeyValueRows";
import { ChipList } from "@/components/ui/ChipList";
import { IconSolutions, IconClock, IconMarketplace, IconAce } from "@/components/ui/icons";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { marketplaceListings, programs } from "@/db/schema";
import { updateSolution } from "@/domain/solutions/actions";
import { loadSolutionDetail } from "@/domain/solutions/load";
import {
  LISTING_STATUS_LABELS,
  listingStatusTone,
  type MarketplaceListingStatusId,
} from "@/domain/marketplace/catalog";
import {
  RENEWAL_BAND_LABELS,
  LAUNCHED_OPP_TARGET,
  type RenewalBand,
} from "@/domain/solutions/renewal";
import {
  SOLUTION_TYPE_OPTIONS,
  SOLUTION_TYPE_LABELS,
  AVAILABILITY_OPTIONS,
  AVAILABILITY_LABELS,
  FTR_STATUS_OPTIONS,
  FTR_STATUS_LABELS,
  PROGRAM_TYPE_OPTIONS,
  solutionTypeLabel,
  availabilityLabel,
  ftrStatusLabel,
} from "@/domain/solutions/labels";
import { money } from "@/domain/format";

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
const textareaStyle = { ...controlStyle, width: "100%", fontFamily: "inherit", resize: "vertical" } as const;


function bandTone(b: RenewalBand): Tone {
  return b === "compliant" ? "ok" : b === "at_risk" ? "warn" : "danger";
}

function availabilityTone(a: string): Tone {
  return a === "available" ? "ok" : a === "beta" ? "info" : "danger";
}

function dueLabel(days: number | null): string | null {
  if (days === null) return null;
  if (days < 0) return `Renewal date passed ${Math.abs(days)}d ago`;
  if (days === 0) return "Renewal date is today";
  return `Renewal due in ${days}d`;
}

export default async function SolutionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const today = new Date().toISOString().slice(0, 10);

  const s = await loadSolutionDetail(identity, id, today);
  if (!s) notFound();
  const due = dueLabel(s.renewal.dueInDays);

  const { marketplaceListingRows, programOptions } = await withTenant(identity, async (tx) => {
    const marketplaceListingRows = await tx
      .select({ id: marketplaceListings.id, title: marketplaceListings.title, status: marketplaceListings.status })
      .from(marketplaceListings)
      .where(and(eq(marketplaceListings.solutionId, s.id), eq(marketplaceListings.tenantId, identity.tenantId)))
      .orderBy(desc(marketplaceListings.createdAt));
    const programOptions = await tx
      .select({ id: programs.id, name: programs.name })
      .from(programs)
      .where(eq(programs.tenantId, identity.tenantId))
      .orderBy(desc(programs.createdAt));
    return { marketplaceListingRows, programOptions };
  });

  const editDrawer = (
    <FormDrawer
      triggerLabel="Edit Solution"
      triggerVariant="secondary"
      title="Edit Solution"
      action={updateSolution}
      submitLabel="Save"
      successMessage="Solution updated."
      hidden={{ solutionId: s.id }}
      width={560}
    >
      <label style={labelStyle}>
        <span style={spanStyle}>Title</span>
        <input name="title" defaultValue={s.title} maxLength={250} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Solution type</span>
        <select name="solutionType" defaultValue={s.solutionType} style={controlStyle}>
          {SOLUTION_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {SOLUTION_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Validated for (program)</span>
        <input name="programType" defaultValue={s.programType} list="program-types" maxLength={60} style={controlStyle} />
        <datalist id="program-types">
          {PROGRAM_TYPE_OPTIONS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Owning competency</span>
        <select name="programId" defaultValue={s.programId ?? ""} style={controlStyle}>
          <option value="">None</option>
          {programOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Availability (Active = Available)</span>
        <select name="availability" defaultValue={s.availability} style={controlStyle}>
          {AVAILABILITY_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {AVAILABILITY_LABELS[a]}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Foundational Technical Review (FTR)</span>
        <select name="ftrStatus" defaultValue={s.ftrStatus} style={controlStyle}>
          {FTR_STATUS_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {FTR_STATUS_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Renewal date (optional)</span>
        <input name="renewalDate" type="date" defaultValue={s.renewalDate ?? ""} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Description</span>
        <textarea name="description" rows={3} defaultValue={s.description} style={textareaStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Selling proposition</span>
        <textarea name="sellingProposition" rows={2} defaultValue={s.sellingProposition} style={textareaStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Solution URL</span>
        <input name="url" type="url" defaultValue={s.url} maxLength={500} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>AWS Marketplace URL</span>
        <input name="marketplaceUrl" type="url" defaultValue={s.marketplaceUrl} maxLength={500} style={controlStyle} />
      </label>
    </FormDrawer>
  );

  return (
    <PageShell width={920}>
      <PageHeader
        breadcrumbs={[
          { href: "/", label: "Home" },
          { href: "/programs?view=solutions", label: "Solutions" },
          { label: s.title },
        ]}
        title={s.title}
        subtitle={
          <>
            {solutionTypeLabel(s.solutionType)}
            {s.programType ? ` · ${s.programType}` : ""}
          </>
        }
        actions={editDrawer}
      />

      <Panel
        title="Renewal readiness"
        accent="var(--section-accent)"
        icon={<IconClock size={16} />}
        actions={<Badge tone={bandTone(s.renewal.band)}>{RENEWAL_BAND_LABELS[s.renewal.band]}</Badge>}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <Badge tone={availabilityTone(s.availability)}>{availabilityLabel(s.availability)}</Badge>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            <strong style={{ color: "var(--text)" }}>{s.launchedCount}</strong>/{LAUNCHED_OPP_TARGET} launched ACE{" "}
            {s.launchedCount === 1 ? "opportunity" : "opportunities"} (rolling 12mo)
          </span>
          {due && (
            <span style={{ fontSize: 12, color: s.renewal.dueInDays !== null && s.renewal.dueInDays <= 90 ? "var(--warn)" : "var(--muted)" }}>
              {due}
            </span>
          )}
        </div>
        <ChipList
          items={s.renewal.criteria.map((c) => ({
            key: c.key,
            label: c.label,
            detail: c.detail,
            badges: <Badge tone={c.ok ? "ok" : "warn"}>{c.ok ? "met" : "gap"}</Badge>,
          }))}
        />
      </Panel>

      <Panel title="Details" accent="var(--section-accent)" icon={<IconSolutions size={16} />}>
        <KeyValueRows
          rows={[
            { label: "FTR status", value: ftrStatusLabel(s.ftrStatus) },
            ...(s.programId && s.programName
              ? [{ label: "Program", value: <Link href={`/programs/${s.programId}`} style={{ color: "var(--section-accent)", textDecoration: "none" }}>{s.programName}</Link> }]
              : []),
            ...(s.sellingProposition ? [{ label: "Selling proposition", value: s.sellingProposition }] : []),
            ...(s.description ? [{ label: "Description", value: <span style={{ whiteSpace: "pre-wrap" }}>{s.description}</span> }] : []),
            ...(s.url ? [{ label: "URL", value: <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--section-accent)" }}>{s.url}</a> }] : []),
            ...(s.marketplaceUrl ? [{ label: "Marketplace", value: <a href={s.marketplaceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--section-accent)" }}>{s.marketplaceUrl}</a> }] : []),
          ]}
        />
        {!s.sellingProposition && !s.description && !s.url && !s.marketplaceUrl && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Add a description, selling proposition, and URLs with Edit Solution.
          </p>
        )}
      </Panel>

      {marketplaceListingRows.length > 0 && (
        <Panel
          title={`AWS Marketplace ${marketplaceListingRows.length === 1 ? "listing" : "listings"} (${marketplaceListingRows.length})`}
          accent="var(--section-accent)"
          icon={<IconMarketplace size={16} />}
        >
          <ChipList
            items={marketplaceListingRows.map((l) => ({
              key: l.id,
              label: l.title,
              href: `/marketplace/${l.id}`,
              badges: (
                <Badge tone={listingStatusTone(l.status as MarketplaceListingStatusId)}>
                  {LISTING_STATUS_LABELS[l.status as MarketplaceListingStatusId]}
                </Badge>
              ),
            }))}
          />
        </Panel>
      )}

      <Panel title={`Linked ACE opportunities (${s.opportunities.length})`} accent="var(--section-accent)" icon={<IconAce size={16} />}>
        <ChipList
          items={s.opportunities.map((o) => ({
            key: o.id,
            label: (
              <>
                {o.name} <span style={{ color: "var(--muted)" }}>· {money(o.amount)}</span>
                {o.closeDate ? <span style={{ color: "var(--muted)" }}> · {o.closeDate}</span> : null}
              </>
            ),
            badges: (
              <>
                <Badge tone={statusTone(o.stage)}>{o.stage}</Badge>
                {o.launched ? <Badge tone="ok">counts (12mo)</Badge> : null}
              </>
            ),
          }))}
          empty={
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              No opportunities linked yet. Link this Solution from an opportunity&apos;s Edit drawer in{" "}
              <Link href="/ace" style={{ color: "var(--section-accent)", textDecoration: "none" }}>
                ACE Pipeline
              </Link>{" "}
              — launched ones in the last 12 months count toward renewal.
            </p>
          }
        />
      </Panel>
    </PageShell>
  );
}
