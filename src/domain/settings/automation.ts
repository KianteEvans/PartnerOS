/**
 * Pure automation governance: which assistant/agent capabilities are permitted
 * at each automation mode, constrained by each capability's risk. No database —
 * deterministic and unit-testable. The product's promise is that the selected
 * mode "remains constrained by capability risk and workspace governance"; this
 * is where that constraint is computed.
 */

export type AutomationMode = "off" | "recommend_only" | "auto_with_approval" | "autonomous";

export const AUTOMATION_MODES: readonly AutomationMode[] = [
  "off",
  "recommend_only",
  "auto_with_approval",
  "autonomous",
];

export const AUTOMATION_MODE_LABELS: Record<AutomationMode, string> = {
  off: "Off",
  recommend_only: "Recommend only",
  auto_with_approval: "Auto with approval",
  autonomous: "Autonomous",
};

export const AUTOMATION_MODE_DESCRIPTIONS: Record<AutomationMode, string> = {
  off: "The assistant takes no automated action.",
  recommend_only: "The assistant proposes; humans act on every change.",
  auto_with_approval: "The assistant can act, but consequential changes wait for approval.",
  autonomous: "The assistant acts without approval, within capability-risk limits.",
};

export type Risk = "low" | "medium" | "high";

export interface Capability {
  readonly key: string;
  readonly label: string;
  readonly risk: Risk;
}

/** The automated capabilities the assistant/agent may exercise. */
export const CAPABILITIES: readonly Capability[] = [
  { key: "generate_recommendations", label: "Generate recommendations", risk: "low" },
  { key: "draft_email", label: "Draft co-sell emails", risk: "low" },
  { key: "create_task", label: "Create tasks", risk: "medium" },
  { key: "route_opportunity", label: "Route opportunities", risk: "medium" },
  { key: "send_email", label: "Send emails", risk: "high" },
];

/** How a capability behaves under a mode. */
export type CapabilityDecision = "blocked" | "recommend" | "approval" | "auto";

export const DECISION_LABELS: Record<CapabilityDecision, string> = {
  blocked: "Blocked",
  recommend: "Recommend only",
  approval: "Auto, needs approval",
  auto: "Automatic",
};

/**
 * Decide how a capability behaves at a mode. High-risk capabilities are never
 * fully automatic outside Autonomous; everything is blocked when Off.
 */
export function capabilityDecision(
  mode: AutomationMode,
  capability: Capability,
): CapabilityDecision {
  if (mode === "off") return "blocked";
  if (mode === "recommend_only") return "recommend";
  if (mode === "auto_with_approval") {
    // Low-risk can run automatically; medium/high require approval.
    return capability.risk === "low" ? "auto" : "approval";
  }
  // autonomous: high-risk still needs approval (governance floor); rest automatic.
  return capability.risk === "high" ? "approval" : "auto";
}

/** The full capability matrix for a mode (for display). */
export function capabilityMatrix(
  mode: AutomationMode,
): { capability: Capability; decision: CapabilityDecision }[] {
  return CAPABILITIES.map((capability) => ({
    capability,
    decision: capabilityDecision(mode, capability),
  }));
}
