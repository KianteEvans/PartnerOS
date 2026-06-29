import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { env } from "@/env";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { DraftCaseStudy } from "@/components/ui/DraftCaseStudy";
import { updateCaseStudy } from "@/domain/case-studies/actions";
import { loadCaseStudyDetail, loadEvidenceOptions } from "@/domain/case-studies/load";
import { CASE_STUDY_ASPECTS } from "@/domain/case-studies/aspects";

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
const textareaStyle = { ...controlStyle, minHeight: 88, fontFamily: "inherit", resize: "vertical" } as const;

export default async function CaseStudyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const aiEnabled = Boolean(env.ANTHROPIC_API_KEY);
  const [cs, evidenceOptions] = await Promise.all([
    loadCaseStudyDetail(identity, id),
    loadEvidenceOptions(identity),
  ]);
  if (!cs) notFound();

  const editDrawer = (
    <FormDrawer
      triggerLabel="Edit"
      triggerVariant="secondary"
      title="Edit case study"
      action={updateCaseStudy}
      submitLabel="Save changes"
      successMessage="Saved."
      submitVariant="secondary"
      hidden={{ caseStudyId: cs.id }}
      width={640}
    >
      <label style={labelStyle}>
        <span style={spanStyle}>Title</span>
        <input name="title" defaultValue={cs.title} maxLength={250} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Customer</span>
        <input name="customerName" defaultValue={cs.customerName} maxLength={250} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Visibility</span>
        <select name="visibility" defaultValue={cs.visibility} style={controlStyle}>
          <option value="private">Private (validation only)</option>
          <option value="public">Public (published to PSF)</option>
        </select>
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <input type="checkbox" name="anonymized" defaultChecked={cs.anonymized} /> Anonymize the customer
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Case study URL (public)</span>
        <input name="url" defaultValue={cs.url} maxLength={500} style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Source evidence</span>
        <select name="evidenceId" defaultValue={cs.evidenceId ?? ""} style={controlStyle}>
          <option value="">None</option>
          {evidenceOptions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </label>
      {CASE_STUDY_ASPECTS.map((a) => (
        <label key={a.key} style={labelStyle}>
          <span style={spanStyle}>{a.label}</span>
          <textarea name={a.key} defaultValue={cs[a.key]} maxLength={4000} style={textareaStyle} />
        </label>
      ))}
    </FormDrawer>
  );

  return (
    <PageShell width={880}>
      <PageHeader
        breadcrumbs={[
          { href: "/", label: "Home" },
          { href: "/programs/evidence", label: "Evidence Locker" },
          { href: "/programs/evidence/case-studies", label: "Case Studies" },
          { label: cs.title },
        ]}
        title={cs.title}
        subtitle={
          <>
            {cs.customerName || "Customer not set"} · {cs.visibility}
            {cs.anonymized ? " · anonymized" : ""}
            {cs.evidenceTitle ? ` · evidence: ${cs.evidenceTitle}` : ""}
          </>
        }
        actions={editDrawer}
      />

      <Panel title="Narrative" actions={<DraftCaseStudy caseStudyId={cs.id} enabled={aiEnabled} />}>
        <div style={{ display: "grid", gap: 14 }}>
          {CASE_STUDY_ASPECTS.map((a) => (
            <div key={a.key}>
              <strong style={{ fontSize: 13 }}>{a.label}</strong>
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 13,
                  color: cs[a.key] ? "var(--text)" : "var(--muted)",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.55,
                }}
              >
                {cs[a.key] || a.hint}
              </p>
            </div>
          ))}
        </div>
      </Panel>
    </PageShell>
  );
}
