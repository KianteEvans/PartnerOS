import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { createCaseStudy } from "@/domain/case-studies/actions";
import { loadCaseStudies, loadEvidenceOptions } from "@/domain/case-studies/load";

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

export default async function CaseStudiesPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const [items, evidenceOptions] = await Promise.all([
    loadCaseStudies(identity),
    loadEvidenceOptions(identity),
  ]);

  const drawer = (
    <FormDrawer
      triggerLabel="New case study"
      title="New case study"
      action={createCaseStudy}
      submitLabel="Create"
      successMessage="Case study created."
    >
      <label style={labelStyle}>
        <span style={spanStyle}>Title</span>
        <input name="title" required maxLength={250} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Customer</span>
        <input name="customerName" maxLength={250} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Visibility</span>
        <select name="visibility" defaultValue="private" style={controlStyle}>
          <option value="private">Private (validation only)</option>
          <option value="public">Public (published to PSF)</option>
        </select>
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <input type="checkbox" name="anonymized" /> Anonymize the customer
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Source evidence (optional)</span>
        <select name="evidenceId" defaultValue="" style={controlStyle}>
          <option value="">None</option>
          {evidenceOptions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </label>
    </FormDrawer>
  );

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { href: "/programs/evidence", label: "Evidence Locker" },
          { label: "Case Studies" },
        ]}
        title="Case Studies"
        subtitle="Reusable AWS customer case studies — proof that counts toward your evidence coverage and attaches to Specialization applications. Draft each narrative from your evidence."
        actions={drawer}
      />

      {items.length === 0 ? (
        <Panel>
          <EmptyState
            title="No case studies yet"
            hint="Create a customer case study and draft the About / Challenge / Goals / Solution / Outcomes narrative from your evidence."
            action={drawer}
          />
        </Panel>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {items.map((c) => (
            <Card key={c.id}>
              <div
                style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}
              >
                <Link
                  href={`/programs/evidence/case-studies/${c.id}`}
                  style={{ color: "var(--accent)", textDecoration: "none", fontSize: 15, fontWeight: 600 }}
                >
                  {c.title}
                </Link>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge tone={c.visibility === "public" ? "ok" : "neutral"}>{c.visibility}</Badge>
                  {c.anonymized && <Badge tone="info">anonymized</Badge>}
                  <Badge tone={c.filled === c.total ? "ok" : c.filled > 0 ? "warn" : "danger"}>
                    {c.filled}/{c.total} drafted
                  </Badge>
                </div>
              </div>
              <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 0" }}>
                {c.customerName || "Customer not set"}
              </p>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
