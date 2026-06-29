import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { RingGauge } from "@/components/ui/RingGauge";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import type { Activation } from "@/domain/onboarding/activation";

/**
 * "Getting started" activation checklist on the workspace home hub. Carries a
 * freshly-onboarded partner from "unlocked" to first value: baseline milestones
 * plus the goal-driven items they declared in onboarding, each with a direct CTA.
 * Driven by the pure `activationChecklist` over live workspace counts; the home
 * page renders it only while incomplete, so it self-retires once activated.
 */
export function HomeActivation({ activation }: { activation: Activation }): ReactNode {
  return (
    <Panel
      title="Getting started"
      accent="info"
      actions={
        <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>
          {activation.doneCount}/{activation.total} done
        </span>
      }
    >
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
        <RingGauge value={activation.percent} max={100} size={92} caption="ready" />
        <div style={{ flex: 1, minWidth: 260, display: "grid", gap: 8 }}>
          {activation.items.map((i) => (
            <div
              key={i.key}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    borderRadius: 999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    color: i.done ? "var(--ok)" : "var(--muted)",
                    background: i.done ? "color-mix(in srgb, var(--ok) 16%, transparent)" : "transparent",
                    border: i.done ? "none" : "1.5px solid var(--border)",
                  }}
                >
                  {i.done ? "✓" : ""}
                </span>
                <span
                  style={{
                    fontSize: 13.5,
                    color: i.done ? "var(--muted)" : "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {i.label}
                </span>
                {i.objectiveDriven && !i.done ? <Badge tone="info">goal</Badge> : null}
              </span>
              {!i.done ? (
                <ButtonLink href={i.href} variant="secondary" size="sm">
                  {i.cta}
                </ButtonLink>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
