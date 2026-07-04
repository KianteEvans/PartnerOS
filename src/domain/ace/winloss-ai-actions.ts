"use server";

import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { auditLog } from "@/db/schema";
import { can } from "@/authz/permissions";
import { winLossNarrativeRateLimiter } from "@/redis/ratelimit";
import { loadWinLoss } from "@/domain/ace/winloss-load";
import { isWinLossAiEnabled, generateWinLossNarrative } from "@/domain/ace/winloss-ai";
import type { WinLossNarrative } from "@/domain/ace/winloss-ai-parse";

/**
 * Server action for the AI win/loss narrative. Mirrors the evidence-evaluator recipe:
 * identity -> feature gate -> per-user rate limit -> recompute the report UNDER RLS
 * (never trust the client) -> call the model on aggregates only -> audit counts only.
 */

export interface WinLossNarrativeState {
  readonly ok: boolean;
  readonly narrative?: WinLossNarrative;
  readonly error?: string;
}

export async function generateWinLossNarrativeAction(
  _prev: WinLossNarrativeState,
  _formData: FormData,
): Promise<WinLossNarrativeState> {
  const identity = await tryGetServerIdentity();
  if (!identity) return { ok: false, error: "Sign in to generate the narrative." };
  if (!can(identity.role, "report:read")) return { ok: false, error: "You don't have access to reporting." };
  if (!isWinLossAiEnabled()) {
    return { ok: false, error: "AI narrative isn't configured. Set ANTHROPIC_API_KEY to enable it." };
  }

  const rl = await winLossNarrativeRateLimiter.limit(`${identity.tenantId}:${identity.userId}`);
  if (!rl.success) {
    const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return { ok: false, error: `Too many narratives — try again in ${retry}s.` };
  }

  const view = await loadWinLoss(identity);
  if (view.report.overall.closed === 0) {
    return { ok: false, error: "No closed deals to analyze yet." };
  }

  try {
    const narrative = await generateWinLossNarrative({ report: view.report, reps: view.reps, strength: view.strength });
    if (!narrative) return { ok: false, error: "Couldn't parse the narrative. Please try again." };
    // Audit — counts only, never the text.
    await withTenant(identity, (tx) =>
      tx.insert(auditLog).values({
        tenantId: identity.tenantId,
        actorUserId: identity.userId,
        action: "ace.winloss_ai_narrative",
        resourceType: "report",
        metadata: { closed: view.report.overall.closed, insights: narrative.insights.length },
      }),
    ).catch(() => undefined);
    return { ok: true, narrative };
  } catch {
    return { ok: false, error: "Couldn't generate the narrative just now. Please try again." };
  }
}
