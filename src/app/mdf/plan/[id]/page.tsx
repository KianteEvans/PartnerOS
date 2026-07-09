import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { MutationForm } from "@/components/ui/MutationForm";
import { MdfNav } from "@/app/mdf/MdfNav";
import {
  updateMdfPlan,
  archiveMdfPlan,
  addMdfPlanItem,
  updateMdfPlanItem,
  removeMdfPlanItem,
  convertMdfPlanItem,
  bulkConvertMdfPlanItems,
} from "@/domain/mdf/plan-actions";
import { loadPlanDetail, availableMdf, type PlanItemRow } from "@/domain/mdf/plan-load";
import {
  APPROVED_ACTIVITIES,
  INELIGIBLE_ACTIVITIES,
  activityByKey,
} from "@/domain/mdf/activity-catalog";
import {
  coFunding,
  derivedDeadlines,
  complianceChecks,
  planSummary,
  isBlocked,
  type PlanItemLike,
  type ComplianceCheck,
} from "@/domain/mdf/compliance";
import { itemRoi, recommendedFit, type FitItem, type PlanFit } from "@/domain/mdf/plan-insights";
import { PlanTimeline } from "@/app/mdf/plan/[id]/PlanTimeline";
import { PlanViews } from "@/app/mdf/plan/[id]/PlanViews";
import { money } from "@/domain/format";
import { PackageFence } from "@/components/ui/PackageFence";
import { packageFenceFor } from "@/domain/packaging/preview";

const SECTION = "var(--section-accent)";
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

function toLike(item: PlanItemRow): PlanItemLike {
  return {
    catalogKey: item.catalogKey,
    startDate: item.startDate,
    endDate: item.endDate,
    totalCost: item.totalCost,
    coFundPct: item.coFundPct,
    expectedPipeline: item.expectedPipeline,
  };
}

function toFitItem(item: PlanItemRow): FitItem {
  return {
    id: item.id,
    catalogKey: item.catalogKey,
    startDate: item.startDate,
    endDate: item.endDate,
    totalCost: item.totalCost,
    coFundPct: item.coFundPct,
    expectedPipeline: item.expectedPipeline,
  };
}

export default async function MdfPlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const fenced = await packageFenceFor("mdf");
  if (fenced) return <PackageFence feature="mdf" previewTier={fenced} />;
  const today = new Date().toISOString().slice(0, 10);

  const [detail, avail] = await Promise.all([loadPlanDetail(identity, id), availableMdf(identity, today)]);
  if (!detail) notFound();
  const { plan, items } = detail;
  const summary = planSummary(items.map(toLike), avail.available, today);
  const fit = recommendedFit(items.map(toFitItem), avail.available, today);
  const convertibleCount = items.filter((it) => it.requestId === null && !isBlocked(toLike(it), today)).length;

  return (
    <PageShell width={920}>
      <PageHeader
        breadcrumbs={[
          { href: "/", label: "Home" },
          { href: "/mdf", label: "MDF" },
          { href: "/mdf/plan", label: "Planner" },
          { label: plan.title },
        ]}
        title={plan.title}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <FormDrawer
              triggerLabel="Edit plan"
              triggerVariant="secondary"
              title="Edit plan"
              action={updateMdfPlan}
              submitLabel="Save"
              submitVariant="secondary"
              successMessage="Plan updated."
              hidden={{ planId: plan.id }}
            >
              <label style={labelStyle}><span style={spanStyle}>Title</span><input name="title" required maxLength={200} defaultValue={plan.title} style={controlStyle} /></label>
              <label style={labelStyle}><span style={spanStyle}>Notes</span><input name="notes" maxLength={2000} defaultValue={plan.notes} style={controlStyle} /></label>
            </FormDrawer>
            {plan.status !== "archived" && (
              <MutationForm action={archiveMdfPlan} submitLabel="Archive" variant="danger" hidden={{ planId: plan.id }} />
            )}
            <Link href={`/mdf/plan/${plan.id}/export`} style={buttonish} prefetch={false}>Export CSV</Link>
            <Link href={`/mdf/plan/${plan.id}/print`} style={buttonish} prefetch={false}>Print packet</Link>
            {convertibleCount > 0 && (
              <MutationForm
                action={bulkConvertMdfPlanItems}
                submitLabel={`Convert all eligible (${convertibleCount})`}
                hidden={{ planId: plan.id }}
              />
            )}
          </div>
        }
      />
      <MdfNav />

      {/* Plan roll-up: planned AWS ask vs available MDF. */}
      <Panel title="Plan vs available MDF" accent={SECTION}>
        <MetricStrip min={150}>
          <MetricCard label="Available to plan" value={money(avail.available)} tone="accent" />
          <MetricCard label="Planned AWS ask" value={money(summary.eligibleAsk)} tone={summary.over ? "danger" : "neutral"} />
          <MetricCard label="Headroom" value={money(summary.headroom)} tone={summary.headroom < 0 ? "danger" : "ok"} />
          <MetricCard label="Total activity cost" value={money(summary.totalCost)} />
          <MetricCard label="Projected pipeline" value={money(summary.projectedPipeline)} />
          <MetricCard label="Plan ROI" value={summary.planRoi == null ? "—" : `${summary.planRoi}x`} tone="accent" />
        </MetricStrip>
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {summary.over ? (
            <Callout tone="danger" title="Over available MDF">
              Your eligible plan ({money(summary.eligibleAsk)}) exceeds available MDF ({money(avail.available)}) by {money(-summary.headroom)}. Trim events or increase the budget.
            </Callout>
          ) : null}
          {summary.blockedCount > 0 ? (
            <Callout tone="warn" title={`${summary.blockedCount} event${summary.blockedCount === 1 ? "" : "s"} blocked by AWS rules`}>
              Blocked events are excluded from the ask and can&rsquo;t be converted until resolved.
            </Callout>
          ) : null}
          {!avail.hasBudget ? (
            <Callout tone="info" title="No active MDF budget">
              Set a budget on the <Link href="/mdf" style={{ color: "var(--accent)" }}>MDF Overview</Link> to check the plan against real headroom.
            </Callout>
          ) : null}
        </div>
      </Panel>

      <Panel
        title={`Candidate events (${items.length})`}
        accent={SECTION}
        actions={
          <FormDrawer
            triggerLabel="Add event"
            title="Add a candidate event"
            action={addMdfPlanItem}
            submitLabel="Add event"
            successMessage="Event added."
            hidden={{ planId: plan.id }}
          >
            <ItemFields defaults={null} />
          </FormDrawer>
        }
      >
        {items.length === 0 ? (
          <EmptyState title="No events yet" hint="Add candidate events grounded in an AWS activity type." />
        ) : (
          <PlanViews
            list={
              <div style={{ display: "grid", gap: 12 }}>
                {items.map((item) => (
                  <PlanItemCard
                    key={item.id}
                    item={item}
                    planId={plan.id}
                    today={today}
                    available={avail.available}
                    fit={fit}
                    over={summary.over}
                  />
                ))}
              </div>
            }
            calendar={
              <PlanTimeline
                events={items.map((it) => ({
                  id: it.id,
                  title: it.title,
                  startDate: it.startDate,
                  endDate: it.endDate,
                  blocked: isBlocked(toLike(it), today),
                }))}
                today={today}
              />
            }
          />
        )}
      </Panel>
    </PageShell>
  );
}

function PlanItemCard({
  item,
  planId,
  today,
  available,
  fit,
  over,
}: {
  item: PlanItemRow;
  planId: string;
  today: string;
  available: number;
  fit: PlanFit;
  over: boolean;
}): ReactNode {
  const activity = activityByKey(item.catalogKey);
  const co = coFunding(item.totalCost, item.coFundPct);
  const deadlines = derivedDeadlines(item.startDate, item.endDate);
  const checks = complianceChecks(toLike(item), today, available);
  const flags = checks.filter((c) => c.severity !== "ok");
  const blocked = checks.some((c) => c.severity === "block");
  const converted = item.requestId !== null;
  const roi = itemRoi({ expectedPipeline: item.expectedPipeline, totalCost: item.totalCost, coFundPct: item.coFundPct });
  // When the plan is over budget, mark which eligible events fit the available MDF.
  const showFit = over && !blocked && !converted;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15 }}>{item.title}</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {activity ? (
            <Badge tone={activity.eligibility === "approved" ? "ok" : "danger"}>
              {activity.eligibility === "approved" ? "Approved" : "Ineligible"}
            </Badge>
          ) : (
            <Badge tone="warn">No activity type</Badge>
          )}
          {blocked ? <Badge tone="danger">Blocked</Badge> : <Badge tone="ok">Eligible</Badge>}
          {showFit ? (
            fit.fitIds.has(item.id) ? <Badge tone="ok">Fits</Badge> : <Badge tone="warn">Defer — over budget</Badge>
          ) : null}
        </div>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "4px 0 10px" }}>
        {activity?.label ?? "Custom activity"}
        {item.startDate ? ` · ${item.startDate} → ${item.endDate ?? "?"}` : ""}
      </p>

      <MetricStrip min={120}>
        <MetricCard label="Total cost" value={money(item.totalCost)} />
        <MetricCard label={`AWS ask (${item.coFundPct}%)`} value={money(co.amountToClaim)} tone="accent" />
        <MetricCard label="Your share" value={money(co.partnerShare)} />
        <MetricCard label="ROI" value={roi == null ? "—" : `${roi}x`} tone="accent" />
        <MetricCard label="Submit by" value={deadlines.submitBy ?? "—"} />
        <MetricCard label="Claim by" value={deadlines.claimBy ?? "—"} />
      </MetricStrip>

      {flags.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          {flags.map((f) => (
            <ComplianceFlag key={f.key} check={f} />
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        {converted ? (
          <Link href={`/mdf/${item.requestId}`} style={{ ...buttonish, color: "var(--accent)", borderColor: "var(--accent)" }}>
            View request ({item.requestStatus})
          </Link>
        ) : blocked ? (
          <span style={{ fontSize: 12.5, color: "var(--danger)" }}>Resolve the blocking AWS issues to convert this event.</span>
        ) : (
          <MutationForm action={convertMdfPlanItem} submitLabel="Convert to MDF request" hidden={{ itemId: item.id }} />
        )}
        {!converted && (
          <FormDrawer
            triggerLabel="Edit"
            triggerVariant="secondary"
            title="Edit event"
            action={updateMdfPlanItem}
            submitLabel="Save"
            submitVariant="secondary"
            successMessage="Event updated."
            hidden={{ planId, itemId: item.id }}
          >
            <ItemFields defaults={item} />
          </FormDrawer>
        )}
        {!converted && (
          <MutationForm action={removeMdfPlanItem} submitLabel="Remove" variant="secondary" hidden={{ planId, itemId: item.id }} />
        )}
      </div>
    </Card>
  );
}

const buttonish = {
  display: "inline-flex",
  alignItems: "center",
  padding: "7px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "none",
} as const;

function ComplianceFlag({ check }: { check: ComplianceCheck }): ReactNode {
  const color = check.severity === "block" ? "var(--danger)" : "var(--warn)";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5 }}>
      <span style={{ color, fontWeight: 700, whiteSpace: "nowrap" }}>{check.severity === "block" ? "Blocked" : "Warning"}</span>
      <span style={{ color: "var(--text)" }}>{check.message}</span>
    </div>
  );
}

/** Shared field set for the add/edit candidate-event drawers. */
function ItemFields({ defaults }: { defaults: PlanItemRow | null }): ReactNode {
  return (
    <>
      <label style={labelStyle}>
        <span style={spanStyle}>Event title</span>
        <input name="title" required maxLength={200} defaultValue={defaults?.title ?? ""} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Description (for the AWS marketing plan)</span>
        <textarea name="description" maxLength={4000} rows={2} defaultValue={defaults?.description ?? ""} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>AWS activity type</span>
        <select name="catalogKey" defaultValue={defaults?.catalogKey ?? ""} style={controlStyle}>
          <option value="">— None / custom —</option>
          <optgroup label="Approved">
            {APPROVED_ACTIVITIES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </optgroup>
          <optgroup label="Ineligible (blocks submission)">
            {INELIGIBLE_ACTIVITIES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </optgroup>
        </select>
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Total activity cost ($)</span>
        <input name="totalCost" type="number" min={0} defaultValue={defaults?.totalCost ?? 0} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>AWS co-fund (%)</span>
        <input name="coFundPct" type="number" min={0} max={100} defaultValue={defaults?.coFundPct ?? 50} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Expected pipeline ($)</span>
        <input name="expectedPipeline" type="number" min={0} defaultValue={defaults?.expectedPipeline ?? 0} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Expected opportunities</span>
        <input name="expectedOpportunities" type="number" min={0} defaultValue={defaults?.expectedOpportunities ?? 0} style={controlStyle} />
      </label>
      <label style={labelStyle}><span style={spanStyle}>Activity start</span><input name="startDate" type="date" defaultValue={defaults?.startDate ?? ""} style={controlStyle} /></label>
      <label style={labelStyle}><span style={spanStyle}>Activity end</span><input name="endDate" type="date" defaultValue={defaults?.endDate ?? ""} style={controlStyle} /></label>
      <label style={labelStyle}><span style={spanStyle}>SPMS ID (optional)</span><input name="spmsId" maxLength={120} defaultValue={defaults?.spmsId ?? ""} style={controlStyle} /></label>
    </>
  );
}
