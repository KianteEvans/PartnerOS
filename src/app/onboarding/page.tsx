import type { ReactNode } from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { onboarding } from "@/db/schema";
import { can } from "@/authz/permissions";
import { Panel } from "@/components/ui/Panel";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { MutationForm } from "@/components/ui/MutationForm";
import {
  startOnboarding,
  saveContext,
  saveObjectives,
  choosePath,
  backToStep,
  completeOnboarding,
} from "@/domain/onboarding/actions";
import {
  INDUSTRY_OPTIONS,
  PARTNER_TYPE_OPTIONS,
  AWS_STAGE_OPTIONS,
  TEAM_SIZE_OPTIONS,
  OBJECTIVE_OPTIONS,
  PATH_OPTIONS,
  STEP_LABELS,
  WIZARD_STEPS,
  progressPercent,
  stepIndex,
  pathToPreset,
  kickoffTasks,
  type OnboardingStepId,
  type PathId,
} from "@/domain/onboarding/catalog";
import { PRESET_LABELS } from "@/domain/assessments/catalog";

const labelStyle = { display: "grid", gap: 4, fontSize: 13 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
} as const;

type Row = typeof onboarding.$inferSelect;

export default async function OnboardingPage(): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const canManage = can(identity.role, "onboarding:manage");

  const [row] = await withTenant(identity, (tx) =>
    tx
      .select()
      .from(onboarding)
      .where(eq(onboarding.tenantId, identity.tenantId)),
  );

  return (
    <PageShell width={760}>
      <PageHeader title="Onboarding" />

      {!canManage && (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          You can view setup progress, but an owner or admin must make changes.
        </p>
      )}

      {!row ? (
        <Welcome canManage={canManage} />
      ) : (
        <>
          <Stepper step={row.step as OnboardingStepId} />
          <StepBody row={row} canManage={canManage} />
        </>
      )}
    </PageShell>
  );
}

function Welcome({ canManage }: { canManage: boolean }): ReactNode {
  return (
    <Panel title="Welcome to PartnerOS">
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        PartnerOS turns fragmented partner data into prioritized decisions,
        approval-gated work, and executive-ready reporting. The operating loop:
      </p>
      <ol style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7 }}>
        <li>Understand the account, objectives, and posture.</li>
        <li>Assess readiness across programs, tiers, GTM, and evidence.</li>
        <li>Plan a sequenced roadmap with owners and dates.</li>
        <li>Approve generated actions through human review.</li>
        <li>Execute in the Task Manager and report outcomes.</li>
      </ol>
      {canManage ? (
        <MutationForm action={startOnboarding} submitLabel="Begin onboarding" />
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Setup hasn’t started yet.
        </p>
      )}
    </Panel>
  );
}

function Stepper({ step }: { step: OnboardingStepId }): ReactNode {
  const pct = progressPercent(step);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {WIZARD_STEPS.map((s, i) => {
          const current = s === step;
          const done = step === "done" || i < stepIndex(step);
          return (
            <span
              key={s}
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: current ? "var(--accent)" : "transparent",
                color: current ? "var(--accent-ink)" : done ? "var(--text)" : "var(--muted)",
                fontWeight: current ? 600 : 400,
              }}
            >
              {i + 1}. {STEP_LABELS[s]}
            </span>
          );
        })}
      </div>
      <div style={{ height: 6, background: "var(--border)", borderRadius: 999 }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--accent)",
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  );
}

function BackButton({ step }: { step: OnboardingStepId }): ReactNode {
  const idx = stepIndex(step);
  if (idx <= 0) return null;
  const prev = WIZARD_STEPS[idx - 1]!;
  return (
    <MutationForm
      action={backToStep}
      submitLabel={`Back to ${STEP_LABELS[prev]}`}
      variant="secondary"
      hidden={{ step: prev }}
    />
  );
}

function StepBody({
  row,
  canManage,
}: {
  row: Row;
  canManage: boolean;
}): ReactNode {
  const step = row.step as OnboardingStepId;

  if (step === "done") {
    return (
      <Panel title="Platform unlocked 🎉">
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Onboarding is complete. We created a starter readiness assessment and
          seeded your initial tasks.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
          {row.assessmentId && (
            <Link href={`/assessments/${row.assessmentId}`} style={linkBtn}>
              Open starter assessment
            </Link>
          )}
          <Link href="/tasks" style={linkBtn}>
            View seeded tasks
          </Link>
          <Link href="/" style={linkBtnGhost}>
            Go to workspace
          </Link>
        </div>
      </Panel>
    );
  }

  if (!canManage) {
    return (
      <Panel title={STEP_LABELS[step]}>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Waiting on an owner or admin to continue setup.
        </p>
      </Panel>
    );
  }

  if (step === "context") {
    return (
      <Panel title="Tell us about your company">
        <MutationForm action={saveContext} submitLabel="Continue">
          <label style={labelStyle}>
            <span style={spanStyle}>Company name</span>
            <input
              name="companyName"
              required
              maxLength={200}
              defaultValue={row.companyName ?? ""}
              style={controlStyle}
            />
          </label>
          <Select name="industry" label="Industry" options={INDUSTRY_OPTIONS} value={row.industry} />
          <Select name="partnerType" label="Partner type" options={PARTNER_TYPE_OPTIONS} value={row.partnerType} />
          <Select name="awsStage" label="Current AWS stage" options={AWS_STAGE_OPTIONS} value={row.awsStage} />
          <Select name="teamSize" label="Team size" options={TEAM_SIZE_OPTIONS} value={row.teamSize} />
        </MutationForm>
      </Panel>
    );
  }

  if (step === "objectives") {
    const chosen = new Set((row.objectives as string[]) ?? []);
    return (
      <Panel title="What are your partnership objectives?">
        <MutationForm action={saveObjectives} submitLabel="Continue">
          <div style={{ display: "grid", gap: 10 }}>
            {OBJECTIVE_OPTIONS.map((o) => (
              <label key={o.key} style={{ display: "flex", gap: 8, fontSize: 14 }}>
                <input
                  type="checkbox"
                  name="objectives"
                  value={o.key}
                  defaultChecked={chosen.has(o.key)}
                />
                {o.label}
              </label>
            ))}
          </div>
        </MutationForm>
        <div style={{ marginTop: 12 }}>
          <BackButton step={step} />
        </div>
      </Panel>
    );
  }

  if (step === "path") {
    return (
      <Panel title="Choose a guided path">
        <MutationForm action={choosePath} submitLabel="Continue">
          <div style={{ display: "grid", gap: 12 }}>
            {PATH_OPTIONS.map((p, i) => (
              <label
                key={p.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: 10,
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <input
                  type="radio"
                  name="path"
                  value={p.key}
                  defaultChecked={row.path ? row.path === p.key : i === 0}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong style={{ fontSize: 14 }}>{p.label}</strong>
                  <span style={{ display: "block", color: "var(--muted)", fontSize: 13 }}>
                    {p.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </MutationForm>
        <div style={{ marginTop: 12 }}>
          <BackButton step={step} />
        </div>
      </Panel>
    );
  }

  // review
  const path = row.path as PathId | null;
  const objectiveLabels = OBJECTIVE_OPTIONS.filter((o) =>
    ((row.objectives as string[]) ?? []).includes(o.key),
  ).map((o) => o.label);
  return (
    <Panel title="Review & unlock">
      <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, fontSize: 14 }}>
        <dt style={spanStyle}>Company</dt>
        <dd style={{ margin: 0 }}>{row.companyName ?? "—"}</dd>
        <dt style={spanStyle}>Industry</dt>
        <dd style={{ margin: 0 }}>{row.industry ?? "—"}</dd>
        <dt style={spanStyle}>Partner type</dt>
        <dd style={{ margin: 0 }}>{row.partnerType ?? "—"}</dd>
        <dt style={spanStyle}>AWS stage</dt>
        <dd style={{ margin: 0 }}>{row.awsStage ?? "—"}</dd>
        <dt style={spanStyle}>Team size</dt>
        <dd style={{ margin: 0 }}>{row.teamSize ?? "—"}</dd>
        <dt style={spanStyle}>Objectives</dt>
        <dd style={{ margin: 0 }}>{objectiveLabels.length ? objectiveLabels.join(", ") : "—"}</dd>
        <dt style={spanStyle}>Guided path</dt>
        <dd style={{ margin: 0 }}>
          {path ? PATH_OPTIONS.find((p) => p.key === path)?.label : "—"}
        </dd>
      </dl>

      {path && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>
            On unlock we’ll create:
          </p>
          <ul style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
            <li>A “{PRESET_LABELS[pathToPreset(path)]}” starter assessment.</li>
            {kickoffTasks(path).map((t) => (
              <li key={t.key}>{t.title}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <MutationForm
          action={completeOnboarding}
          submitLabel="Complete & unlock platform"
        />
        <BackButton step="review" />
      </div>
    </Panel>
  );
}

function Select({
  name,
  label,
  options,
  value,
}: {
  name: string;
  label: string;
  options: readonly string[];
  value: string | null;
}): ReactNode {
  return (
    <label style={labelStyle}>
      <span style={spanStyle}>{label}</span>
      <select name={name} defaultValue={value ?? ""} required style={controlStyle}>
        <option value="" disabled>
          Select…
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

const linkBtn = {
  background: "var(--accent)",
  color: "var(--accent-ink)",
  padding: "8px 16px",
  borderRadius: 8,
  fontWeight: 600,
  textDecoration: "none",
} as const;

const linkBtnGhost = {
  background: "transparent",
  color: "var(--text)",
  border: "1px solid var(--border)",
  padding: "8px 16px",
  borderRadius: 8,
  fontWeight: 600,
  textDecoration: "none",
} as const;
