"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { MutationForm } from "@/components/ui/MutationForm";
import { createComposedRoadmap } from "@/domain/roadmaps/actions";
import { composeMilestones } from "@/domain/roadmaps/compose";
import {
  planRoadmap,
  HORIZON_LABELS,
  SCENARIO_LABELS,
  type HorizonId,
  type ScenarioId,
} from "@/domain/roadmaps/planner";
import type { TierId } from "@/domain/tiers/catalog";
import type { RoadmapRecommendation } from "@/domain/roadmaps/recommend-filter";

/**
 * The interactive Roadmap Builder. Customers pick the AWS programs and the
 * partner tier they want to pursue; the milestone plan assembles in a live
 * preview that reflows on every change — because the same pure `composeMilestones`
 * + `planRoadmap` run here in the browser as run server-side on submit, the
 * preview can't drift from what gets created. Owners are assigned per milestone
 * as the plan is built and travel through a JSON hidden field.
 */

export interface ComposerProgram {
  readonly key: string;
  readonly name: string;
  readonly programType: string;
  readonly deliveryModel: string;
  readonly fundingFit: string;
  readonly requirementCount: number;
}
export interface ComposerTier {
  readonly id: TierId;
  readonly label: string;
  readonly thresholdCount: number;
}
export interface ComposerMember {
  readonly id: string;
  readonly email: string;
}

const label = { display: "grid", gap: 4, fontSize: 13 } as const;
const muted = { color: "var(--muted)" } as const;
const control: CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 13,
};
const heading: CSSProperties = { fontSize: 13, fontWeight: 600, margin: 0 };
const hint: CSSProperties = { color: "var(--muted)", fontSize: 12, margin: 0 };
const previewRow: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  background: "var(--bg)",
};
const seqBadge: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  borderRadius: 999,
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontSize: 11,
  fontWeight: 700,
  flexShrink: 0,
};

const HORIZONS = Object.keys(HORIZON_LABELS) as HorizonId[];
const SCENARIOS = Object.keys(SCENARIO_LABELS) as ScenarioId[];
const FUNDING_TONE: Record<string, Tone> = {
  high: "ok",
  medium: "info",
  low: "neutral",
};

function selectableCard(on: boolean): CSSProperties {
  return {
    textAlign: "left",
    display: "grid",
    gap: 4,
    padding: "10px 12px",
    borderRadius: 10,
    cursor: "pointer",
    background: on
      ? "color-mix(in srgb, var(--accent) 10%, var(--bg))"
      : "var(--bg)",
    border: on ? "1px solid var(--accent)" : "1px solid var(--border)",
    color: "var(--text)",
  };
}
function pill(on: boolean): CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 999,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    background: on ? "var(--accent)" : "var(--bg)",
    color: on ? "var(--accent-ink)" : "var(--text)",
    border: on ? "1px solid var(--accent)" : "1px solid var(--border)",
  };
}

export function RoadmapComposer({
  programs,
  tiers,
  currentTierLabel,
  members,
  today,
  recommendations = [],
}: {
  programs: readonly ComposerProgram[];
  tiers: readonly ComposerTier[];
  currentTierLabel: string;
  members: readonly ComposerMember[];
  today: string;
  recommendations?: readonly RoadmapRecommendation[];
}): ReactNode {
  const [objective, setObjective] = useState("");
  const [horizon, setHorizon] = useState<HorizonId>("m6");
  const [scenario, setScenario] = useState<ScenarioId>("standard");
  const [startDate, setStartDate] = useState(today);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [targetTier, setTargetTier] = useState<TierId | "">("");
  const [owners, setOwners] = useState<Record<string, string>>({});

  const composed = useMemo(
    () =>
      composeMilestones({
        programKeys: selected,
        targetTier: targetTier === "" ? null : targetTier,
      }),
    [selected, targetTier],
  );
  const drafts = useMemo(
    () =>
      composed.length === 0
        ? []
        : planRoadmap(
            { horizon, scenario, startDate, objective },
            composed.map((c) => ({ title: c.title, detail: c.detail })),
          ),
    [composed, horizon, scenario, startDate, objective],
  );

  const toggleProgram = (key: string): void =>
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  const setOwner = (key: string, userId: string): void =>
    setOwners((prev) => ({ ...prev, [key]: userId }));

  const programCount = composed.filter((c) => c.originKind === "program").length;
  const tierCount = composed.filter((c) => c.originKind === "tier").length;

  return (
    <MutationForm action={createComposedRoadmap} submitLabel="Create roadmap">
      {/* state-driven hidden fields */}
      <input type="hidden" name="programKeys" value={selected.join(",")} />
      <input type="hidden" name="targetTier" value={targetTier} />
      <input type="hidden" name="owners" value={JSON.stringify(owners)} />
      <input type="hidden" name="horizon" value={horizon} />
      <input type="hidden" name="scenario" value={scenario} />
      <input type="hidden" name="startDate" value={startDate} />

      <label style={label}>
        <span style={muted}>Roadmap name</span>
        <input
          name="name"
          required
          maxLength={200}
          placeholder="e.g. FY26 differentiation plan"
          style={control}
        />
      </label>
      <label style={label}>
        <span style={muted}>Objective</span>
        <input
          name="objective"
          maxLength={500}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="What this plan helps you win"
          style={control}
        />
      </label>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 18,
          alignItems: "start",
        }}
      >
        {/* LEFT: selection */}
        <div style={{ display: "grid", gap: 16 }}>
          {recommendations.length > 0 && (
            <section style={{ display: "grid", gap: 8 }}>
              <h3 style={{ ...heading, color: "var(--section-accent)" }}>Recommended for you</h3>
              <p style={hint}>Best-fit AWS programs from your evidence, business model, and assessments.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {recommendations.slice(0, 6).map((r) => {
                  const on = selected.includes(r.key);
                  return (
                    <button
                      type="button"
                      key={r.key}
                      onClick={() => toggleProgram(r.key)}
                      aria-pressed={on}
                      title={r.topRationale.map((c) => c.detail).join(" · ")}
                      style={pill(on)}
                    >
                      {r.name}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section style={{ display: "grid", gap: 8 }}>
            <h3 style={heading}>Programs &amp; competencies</h3>
            <p style={hint}>Pick the AWS programs you want to earn.</p>
            <div style={{ display: "grid", gap: 8 }}>
              {programs.map((p) => {
                const on = selected.includes(p.key);
                return (
                  <button
                    type="button"
                    key={p.key}
                    onClick={() => toggleProgram(p.key)}
                    aria-pressed={on}
                    style={selectableCard(on)}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <strong style={{ fontSize: 13 }}>{p.name}</strong>
                      <Badge tone={FUNDING_TONE[p.fundingFit] ?? "neutral"}>
                        {p.fundingFit} fit
                      </Badge>
                    </div>
                    <span style={{ ...muted, fontSize: 12 }}>
                      {p.programType} · {p.deliveryModel} · {p.requirementCount}{" "}
                      requirements
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section style={{ display: "grid", gap: 8 }}>
            <h3 style={heading}>Tier advancement</h3>
            <p style={hint}>
              You&apos;re {currentTierLabel}. Choose a tier to target.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                onClick={() => setTargetTier("")}
                aria-pressed={targetTier === ""}
                style={pill(targetTier === "")}
              >
                None
              </button>
              {tiers.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => setTargetTier(t.id)}
                  aria-pressed={targetTier === t.id}
                  style={pill(targetTier === t.id)}
                >
                  {t.label} · {t.thresholdCount} goals
                </button>
              ))}
              {tiers.length === 0 && (
                <span style={{ ...muted, fontSize: 12 }}>
                  You&apos;re at the top tier — no advancement targets.
                </span>
              )}
            </div>
          </section>

          <section style={{ display: "grid", gap: 8 }}>
            <h3 style={heading}>Timeline</h3>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={label}>
                <span style={muted}>Horizon</span>
                <select
                  value={horizon}
                  onChange={(e) => setHorizon(e.target.value as HorizonId)}
                  style={control}
                >
                  {HORIZONS.map((h) => (
                    <option key={h} value={h}>
                      {HORIZON_LABELS[h]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={label}>
                <span style={muted}>Scenario</span>
                <select
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as ScenarioId)}
                  style={control}
                >
                  {SCENARIOS.map((s) => (
                    <option key={s} value={s}>
                      {SCENARIO_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={label}>
                <span style={muted}>Start date</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={control}
                />
              </label>
            </div>
          </section>
        </div>

        {/* RIGHT: live preview */}
        <div
          style={{
            display: "grid",
            gap: 10,
            alignContent: "start",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <h3 style={heading}>Your plan</h3>
            <span style={{ ...muted, fontSize: 12 }}>
              {drafts.length} milestone{drafts.length === 1 ? "" : "s"}
            </span>
          </div>
          {drafts.length === 0 ? (
            <p style={{ ...muted, fontSize: 13, margin: 0 }}>
              Select programs or a tier on the left and your milestone plan
              assembles here.
            </p>
          ) : (
            <>
              <span style={{ ...muted, fontSize: 12 }}>
                {programCount} program{programCount === 1 ? "" : "s"} · {tierCount}{" "}
                tier goal{tierCount === 1 ? "" : "s"} · through{" "}
                {drafts.at(-1)!.targetDate}
              </span>
              <ol
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "grid",
                  gap: 8,
                }}
              >
                {drafts.map((d, i) => {
                  const meta = composed[i]!;
                  return (
                    <li key={meta.key} style={previewRow}>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={seqBadge}>{d.sequence}</span>
                        <strong style={{ fontSize: 13 }}>{d.title}</strong>
                        <Badge tone={meta.originKind === "tier" ? "info" : "accent"}>
                          {meta.originLabel}
                        </Badge>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          alignItems: "center",
                          marginTop: 6,
                        }}
                      >
                        <span style={{ ...muted, fontSize: 12 }}>
                          Target {d.targetDate}
                        </span>
                        <select
                          value={owners[meta.key] ?? ""}
                          onChange={(e) => setOwner(meta.key, e.target.value)}
                          aria-label={`Owner for ${d.title}`}
                          style={{
                            ...control,
                            padding: "4px 8px",
                            fontSize: 12,
                            maxWidth: 180,
                          }}
                        >
                          <option value="">Unassigned</option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.email}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      </div>
    </MutationForm>
  );
}
