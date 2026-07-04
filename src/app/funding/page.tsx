import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { MetricCard } from "@/components/ui/MetricCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { FundingNav } from "@/app/funding/FundingNav";
import { ApplyDrawer } from "@/app/funding/ApplyDrawer";
import {
  FUNDING_PROGRAMS,
  FUNDING_CATEGORY_LABELS,
  FUNDING_TYPE_LABELS,
  type FundingCategory,
  type FundingType,
} from "@/domain/funding/catalog";
import { money } from "@/domain/format";

const TYPE_TONE: Record<FundingType, "ok" | "info" | "accent"> = { cash: "ok", credits: "info", both: "accent" };

export default async function FundingCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const { cat } = await searchParams;

  const categories = [...new Set(FUNDING_PROGRAMS.map((p) => p.category))];
  // A mistyped ?cat= gets a clean URL back, not a silent "all" under it.
  if (cat !== undefined && cat !== "all" && !(categories as string[]).includes(cat)) redirect("/funding");
  const active: FundingCategory | "all" =
    cat && (categories as string[]).includes(cat) ? (cat as FundingCategory) : "all";
  const shown = active === "all" ? FUNDING_PROGRAMS : FUNDING_PROGRAMS.filter((p) => p.category === active);

  const cash = FUNDING_PROGRAMS.filter((p) => p.fundingType !== "credits").length;
  const credits = FUNDING_PROGRAMS.filter((p) => p.fundingType !== "cash").length;

  return (
    <PageShell>
      <PageHeader
        title="AWS Funding"
        subtitle="Every AWS partner funding program in one place — see which mechanisms fit your deals, then apply and track submissions. ACE can't do this."
      />
      <FundingNav />

      <MetricStrip>
        <MetricCard label="Programs" value={String(FUNDING_PROGRAMS.length)} sub="funding mechanisms" />
        <MetricCard label="Cash" value={String(cash)} tone="ok" sub="cash incentives" />
        <MetricCard label="Credits" value={String(credits)} tone="info" sub="AWS credit programs" />
        <MetricCard label="Categories" value={String(categories.length)} sub="migration → incentive" />
      </MetricStrip>

      <SegmentedControl
        options={[
          { value: "all", label: "All" },
          ...categories.map((c) => ({ value: c, label: FUNDING_CATEGORY_LABELS[c] })),
        ]}
        value={active}
        hrefFor={(v) => (v === "all" ? "/funding" : `/funding?cat=${v}`)}
        size="sm"
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
        {shown.map((p) => (
          <Card key={p.key} style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <strong style={{ fontSize: 14.5 }}>{p.name}</strong>
              <Badge tone={TYPE_TONE[p.fundingType]}>{FUNDING_TYPE_LABELS[p.fundingType]}</Badge>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Badge tone="neutral">{FUNDING_CATEGORY_LABELS[p.category]}</Badge>
              {p.capUsd !== null ? <Badge tone="neutral">up to {money(p.capUsd)}</Badge> : <Badge tone="neutral">deal-scoped</Badge>}
              <Badge tone="neutral">~{p.typicalTimelineDays}d</Badge>
              {p.managedInternally === "mdf" && <Badge tone="info">Managed in MDF</Badge>}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{p.description}</p>
            <div style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)" }}>Eligibility</span>
              <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 2 }}>
                {p.eligibility.slice(0, 2).map((c, i) => (
                  <li key={i} style={{ fontSize: 12, color: "var(--text)" }}>
                    {c.label}
                  </li>
                ))}
              </ul>
              {p.eligibility.length > 2 && (
                <details>
                  <summary style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
                    +{p.eligibility.length - 2} more criteria
                  </summary>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 16, display: "grid", gap: 2 }}>
                    {p.eligibility.slice(2).map((c, i) => (
                      <li key={i} style={{ fontSize: 12, color: "var(--text)" }}>
                        {c.label}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
              {p.managedInternally === "mdf" ? (
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  Requested and claimed through the MDF workspace.{" "}
                  <Link href="/mdf" style={{ color: "var(--section-accent)", fontWeight: 600, textDecoration: "none" }}>
                    Open MDF →
                  </Link>
                </span>
              ) : (
                <ApplyDrawer program={p} triggerLabel="Apply" />
              )}
              <Link href="/funding/eligibility" style={{ color: "var(--muted)", fontSize: 12.5, textDecoration: "none" }}>
                Check my deals
              </Link>
            </div>
          </Card>
        ))}
      </div>

      <p style={{ margin: 0, fontSize: 11.5, color: "var(--muted)" }}>
        Programs, caps, and eligibility are an indicative model — verify current terms in the AWS Partner Funding Portal before submitting.
      </p>
    </PageShell>
  );
}
