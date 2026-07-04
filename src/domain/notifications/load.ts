import type { DbIdentity } from "@/db/client";
import { loadCommandShared } from "@/domain/command/load";
import { deriveDecisions, type Decision } from "@/domain/command/brief";

/**
 * Notification feed for the global top bar. Reuses the Command Center's pure
 * `deriveDecisions` — the canonical "what needs attention" derivation — over the
 * SAME per-request cached inputs build the Command Center itself uses (React
 * cache() in command/load.ts). On /command and the home hub the cross-section
 * gather therefore runs once per request instead of twice; on other pages the
 * bell streams in behind the page shell (see layout), so it never blocks TTFB.
 * Read-only: this path never triggers the playbook automation pass.
 *
 * Snoozed decisions (decision_dismissals) are filtered out here — the bell is a
 * presentation surface. The playbook runner and analysis surfaces read the raw
 * queue (see CommandData.dismissedIds).
 */
export interface NotificationData {
  readonly items: readonly Decision[];
  readonly count: number;
}

export async function loadNotifications(
  identity: DbIdentity,
  today: string,
): Promise<NotificationData> {
  const { inputs, dismissedIds } = await loadCommandShared(identity, today);
  const items = deriveDecisions(inputs, today).filter((d) => !dismissedIds.has(d.id));
  return { items, count: items.length };
}
