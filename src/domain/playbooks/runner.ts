import { eq } from "drizzle-orm";
import type { DbIdentity } from "@/db/client";
import { workspaceSettings } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { can, type Role } from "@/authz/permissions";
import { deriveDecisions } from "@/domain/command/brief";
import type { CommandInputs } from "@/domain/command/types";
import type { AutomationMode } from "@/domain/settings/automation";
import { materializePlaybookRunsOp } from "./operations";

/**
 * Request-time trigger: fire the tenant's playbooks off the live decision queue
 * whenever the Command Center loads (the materialize-on-read pattern, like
 * captureMetricSnapshot). Runs inside the caller's tenant transaction. Guarded to
 * users who could run playbooks manually, skipped when automation is off, and
 * fully swallowed on error — a misconfigured rule must never break the page.
 */
export async function maybeRunPlaybooks(
  identity: DbIdentity,
  tx: MutationContext["tx"],
  inputs: CommandInputs,
  today: string,
): Promise<void> {
  if (!can(identity.role as Role, "playbook:run")) return;
  try {
    const rows = await tx
      .select({ mode: workspaceSettings.automationMode })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.tenantId, identity.tenantId))
      .limit(1);
    const mode = (rows[0]?.mode as AutomationMode | undefined) ?? "recommend_only";
    if (mode === "off") return;
    // Deliberately the RAW queue: a bell snooze (decision_dismissals) hides a
    // decision from people, not from automation — playbooks still fire on it.
    const decisions = deriveDecisions(inputs, today);
    // The engine only needs tenant + user from the identity; synthesize the rest.
    const ctx = {
      identity: { tenantId: identity.tenantId, userId: identity.userId, role: identity.role, oidcSubject: "", email: "", epoch: 0 },
      tx,
    } as unknown as MutationContext;
    await materializePlaybookRunsOp(ctx, { decisions, mode, today });
  } catch {
    // Swallow — automation must never take down the surface that triggered it.
  }
}
