import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { MutationForm } from "@/components/ui/MutationForm";
import { createAssessment } from "@/domain/assessments/actions";
import {
  PRESET_LABELS,
  PRESET_MODULES,
  MODULE_LABELS,
  type PresetId,
} from "@/domain/assessments/catalog";

const labelStyle = { display: "grid", gap: 4, fontSize: 13 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
} as const;

const PRESETS = Object.keys(PRESET_LABELS) as PresetId[];

/** Create a new draft assessment. On success the action redirects to its page. */
export default async function NewAssessmentPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");

  return (
    <PageShell width={640}>
      <PageHeader
        back={{ href: "/assessments", label: "Assessments" }}
        title="New readiness assessment"
      />
      <Panel>
        <MutationForm action={createAssessment} submitLabel="Create draft">
          <label style={labelStyle}>
            <span style={spanStyle}>Name</span>
            <input
              name="name"
              required
              maxLength={200}
              placeholder="Q3 Migration Competency readiness"
              style={controlStyle}
            />
          </label>

          <label style={labelStyle}>
            <span style={spanStyle}>Preset</span>
            <select name="preset" defaultValue="program_submission" style={controlStyle}>
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]} — {PRESET_MODULES[p].map((m) => MODULE_LABELS[m]).join(", ")}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            <span style={spanStyle}>Target AWS program (optional)</span>
            <input
              name="targetProgram"
              maxLength={200}
              placeholder="e.g. Migration Competency"
              style={controlStyle}
            />
          </label>
        </MutationForm>
      </Panel>
    </PageShell>
  );
}
