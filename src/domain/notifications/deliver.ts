import type { Decision } from "@/domain/command/brief";

/**
 * Pure rendering for delivered notifications. Turns a triggering Decision + its
 * playbook into the persisted notification shape and the outbound webhook payload.
 * The HMAC signing + actual send live in the impure delivery adapter; here we only
 * build stable, testable content (dedupe key, canonical JSON).
 */

export interface RenderedNotification {
  readonly severity: string;
  readonly title: string;
  readonly body: string;
  readonly link: string;
  readonly dedupeKey: string;
}

export function renderNotification(
  decision: Decision,
  playbook: { readonly id: string; readonly name: string },
): RenderedNotification {
  return {
    severity: decision.severity,
    title: decision.title,
    body: decision.detail,
    link: decision.link,
    // Unique per (playbook, decision) so re-evaluation on reload never re-notifies.
    dedupeKey: `${playbook.id}:${decision.id}`,
  };
}

export interface WebhookPayload {
  readonly type: "notification";
  readonly severity: string;
  readonly situation: string;
  readonly title: string;
  readonly detail: string;
  readonly link: string;
  readonly playbook: string;
}

export function webhookPayload(decision: Decision, playbookName: string): WebhookPayload {
  return {
    type: "notification",
    severity: decision.severity,
    situation: decision.situation,
    title: decision.title,
    detail: decision.detail,
    link: decision.link,
    playbook: playbookName,
  };
}

/** Canonical JSON string that is both sent and signed (order is fixed by the type). */
export function canonicalPayload(payload: WebhookPayload): string {
  return JSON.stringify(payload);
}
