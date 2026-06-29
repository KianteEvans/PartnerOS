import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge, statusTone, type Tone } from "@/components/ui/Badge";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { updateSolution } from "@/domain/solutions/actions";
import { loadSolutionDetail } from "@/domain/solutions/load";
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

const money = (n: number): string => `$${n.toLocaleString()}`;

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
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {s.renewal.criteria.map((c) => (
            <li
              key={c.key}
              style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ fontSize: 13 }}>{c.label}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{c.detail}</span>
              </div>
              <Badge tone={c.ok ? "ok" : "warn"}>{c.ok ? "met" : "gap"}</Badge>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Details">
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: 0, fontSize: 13 }}>
          <dt style={spanStyle}>FTR status</dt>
          <dd style={{ margin: 0 }}>{ftrStatusLabel(s.ftrStatus)}</dd>
          {s.sellingProposition && (
            <>
              <dt style={spanStyle}>Selling proposition</dt>
              <dd style={{ margin: 0 }}>{s.sellingProposition}</dd>
            </>
          )}
          {s.description && (
            <>
              <dt style={spanStyle}>Description</dt>
              <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{s.description}</dd>
            </>
          )}
          {s.url && (
            <>
              <dt style={spanStyle}>URL</dt>
              <dd style={{ margin: 0 }}>
                <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  {s.url}
                </a>
              </dd>
            </>
          )}
          {s.marketplaceUrl && (
            <>
              <dt style={spanStyle}>Marketplace</dt>
              <dd style={{ margin: 0 }}>
                <a href={s.marketplaceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  {s.marketplaceUrl}
                </a>
              </dd>
            </>
          )}
        </dl>
        {!s.sellingProposition && !s.description && !s.url && !s.marketplaceUrl && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Add a description, selling proposition, and URLs with Edit Solution.
          </p>
        )}
      </Panel>

      <Panel title={`Linked ACE opportunities (${s.opportunities.length})`}>
        {s.opportunities.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            No opportunities linked yet. Link this Solution from an opportunity&apos;s Edit drawer in{" "}
            <Link href="/ace" style={{ color: "var(--accent)", textDecoration: "none" }}>
              ACE Pipeline
            </Link>{" "}
            — launched ones in the last 12 months count toward renewal.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {s.opportunities.map((o) => (
              <li
                key={o.id}
                style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}
              >
                <span style={{ fontSize: 13 }}>
                  {o.name} <span style={{ color: "var(--muted)" }}>· {money(o.amount)}</span>
                  {o.closeDate ? <span style={{ color: "var(--muted)" }}> · {o.closeDate}</span> : null}
                </span>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge tone={statusTone(o.stage)}>{o.stage}</Badge>
                  {o.launched && <Badge tone="ok">counts (12mo)</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </PageShell>
  );
}
