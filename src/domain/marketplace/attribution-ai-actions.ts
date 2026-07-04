"use server";

import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { auditLog } from "@/db/schema";
import { can } from "@/authz/permissions";
import { attributionAdvisorRateLimiter } from "@/redis/ratelimit";
import { loadAttributionAdvisor } from "@/domain/marketplace/advisor-load";
import { buildAttributionInsights } from "@/domain/marketplace/attribution-insights";
import { isAttributionAdvisorEnabled, generateAttributionAdvice } from "@/domain/marketplace/attribution-ai";
import type { AttributionAdvice } from "@/domain/marketplace/attribution-ai-parse";

/**
 * Server action for the AI attribution read-out. Mirrors the win/loss-narrative
 * recipe: identity -> permission -> feature gate -> per-user rate limit ->
 * recompute the insights UNDER RLS (never trust the client) -> call the model on
 * aggregates only -> audit counts only.
 */

export interface AttributionAdviceState {
  readonly ok: boolean;
  readonly advice?: AttributionAdvice;
  readonly error?: string;
}

export async function generateAttributionAdviceAction(
  _prev: AttributionAdviceState,
  _formData: FormData,
): Promise<AttributionAdviceState> {
  const identity = await tryGetServerIdentity();
  if (!identity) return { ok: false, error: "Sign in to generate the read-out." };
  if (!can(identity.role, "marketplace:read")) {
    return { ok: false, error: "You don't have access to Marketplace." };
  }
  if (!isAttributionAdvisorEnabled()) {
    return { ok: false, error: "AI read-out isn't configured. Set ANTHROPIC_API_KEY to enable it." };
  }

  const rl = await attributionAdvisorRateLimiter.limit(`${identity.tenantId}:${identity.userId}`);
  if (!rl.success) {
    const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return { ok: false, error: `Too many read-outs — try again in ${retry}s.` };
  }

  const insights = buildAttributionInsights(await loadAttributionAdvisor(identity));
  if (insights.attributedCents === 0 && insights.billedCents === 0) {
    return { ok: false, error: "No attribution or billing data to analyze yet." };
  }

  try {
    const advice = await generateAttributionAdvice(insights);
    if (!advice) return { ok: false, error: "Couldn't parse the read-out. Please try again." };
    // Audit — counts only, never the text.
    await withTenant(identity, (tx) =>
      tx.insert(auditLog).values({
        tenantId: identity.tenantId,
        actorUserId: identity.userId,
        action: "marketplace.attribution_advisor",
        resourceType: "marketplace",
        metadata: { findings: insights.findings.length, advice: advice.advice.length },
      }),
    ).catch(() => undefined);
    return { ok: true, advice };
  } catch {
    return { ok: false, error: "Couldn't generate the read-out just now. Please try again." };
  }
}
