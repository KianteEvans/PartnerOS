import type { Permission } from "@/authz/permissions";
import type { Situation } from "@/domain/command/brief";
import { getCapability, type Capability } from "@/domain/settings/automation";

/**
 * Pure catalog for the playbook engine: the action palette, which situations each
 * action can respond to, the base permission a human needs to perform the action
 * manually (so unattended `auto` runs are pre-authorized), and the capability that
 * decides the action's automation risk. No database — deterministic + unit-tested.
 */

export type PlaybookActionType =
  | "create_task"
  | "route_opportunity"
  | "approve_within_cap"
  | "generate_report"
  | "notify";

export const PLAYBOOK_ACTION_TYPES: readonly PlaybookActionType[] = [
  "create_task",
  "route_opportunity",
  "approve_within_cap",
  "generate_report",
  "notify",
];

export type NotifyChannel = "in_app" | "email" | "webhook";
export const NOTIFY_CHANNELS: readonly NotifyChannel[] = ["in_app", "email", "webhook"];

export interface ActionDef {
  readonly type: PlaybookActionType;
  readonly label: string;
  /** The `CAPABILITIES` key whose risk gates automatic execution. */
  readonly capabilityKey: string;
  /** Situations this action can respond to, or "any". */
  readonly appliesTo: readonly Situation[] | "any";
}

export const ACTION_CATALOG: Record<PlaybookActionType, ActionDef> = {
  create_task: {
    type: "create_task",
    label: "Create a follow-up task",
    capabilityKey: "create_task",
    appliesTo: "any",
  },
  route_opportunity: {
    type: "route_opportunity",
    label: "Route the opportunity to an owner",
    capabilityKey: "route_opportunity",
    appliesTo: ["aws_review", "stalled_deal"],
  },
  approve_within_cap: {
    type: "approve_within_cap",
    label: "Approve the request within a cap",
    capabilityKey: "approve_request",
    appliesTo: ["mdf_deadline", "funding_deadline"],
  },
  generate_report: {
    type: "generate_report",
    label: "Generate a report",
    capabilityKey: "generate_report",
    appliesTo: "any",
  },
  notify: {
    type: "notify",
    label: "Send a notification",
    capabilityKey: "generate_recommendations",
    appliesTo: "any",
  },
};

/** Whether an action can respond to a given trigger situation. */
export function actionAppliesTo(actionType: PlaybookActionType, situation: string): boolean {
  const def = ACTION_CATALOG[actionType];
  return def.appliesTo === "any" || (def.appliesTo as readonly string[]).includes(situation);
}

/**
 * The base permission a human needs to perform the action manually. For approvals
 * it depends on the trigger (MDF vs funding). Returned so `createPlaybookOp` can
 * assert the creator holds it — the authorization for later unattended runs.
 */
export function basePermissionFor(actionType: PlaybookActionType, situation: string): Permission {
  switch (actionType) {
    case "create_task":
      return "task:create";
    case "route_opportunity":
      return "ace:update";
    case "generate_report":
      return "report:create";
    case "approve_within_cap":
      return situation === "funding_deadline" ? "funding:approve" : "mdf:approve";
    case "notify":
      return "command:read";
  }
}

/**
 * The capability whose risk gates automatic execution. For `notify` the effective
 * risk is the highest across the selected channels (email/webhook are high-risk
 * external sends; in-app is low). Feeds `capabilityDecision(mode, capability)`.
 */
export function capabilityForAction(actionType: PlaybookActionType, channels: readonly NotifyChannel[]): Capability {
  if (actionType !== "notify") return getCapability(ACTION_CATALOG[actionType].capabilityKey);
  if (channels.includes("email")) return getCapability("send_email");
  if (channels.includes("webhook")) return getCapability("send_webhook");
  return getCapability("generate_recommendations");
}
