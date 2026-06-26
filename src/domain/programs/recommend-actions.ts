"use server";

import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { auditLog } from "@/db/schema";
import { recommendNarrativeRateLimiter } from "@/redis/ratelimit";
import { loadCompetencyRecommendations } from "@/domain/programs/recommend-load";
import { narrateRecommendations, isRecommendNarrativeEnabled } from "@/domain/programs/recommend-client";

/**
 * Server action behind the optional "Summarize with AI" button on the Recommended
 * view. Read-only w.r.t. domain data (audit insert only), like the evidence
 * evaluator, so it does NOT go through the mutation gate. It reaches a paid external
 * API, so it requires a live session, is key-gated, rate-limited per user, and
 * RE-DERIVES its inputs server-side under RLS (never trusting the client form). The
 * audit records counts only — never the recommendation contents.
 */

export interface RecommendNarrativeState {
  ok: boolean;
  narrative?: string;
  topPick?: string | null;
  error?: string;
}

const TOP_N = 3;

export async function recommendNarrativeAction(
  _prev: RecommendNarrativeState,
  _formData: FormData,
): Promise<RecommendNarrativeState> {
  const identity = await tryGetServerIdentity();
  if (!identity) return { ok: false, error: "Sign in to summarize recommendations." };

  if (!isRecommendNarrativeEnabled()) {
    return { ok: false, error: "AI summary isn't configured. Set ANTHROPIC_API_KEY to enable it." };
  }

  const rl = await recommendNarrativeRateLimiter.limit(`${identity.tenantId}:${identity.userId}`);
  if (!rl.success) {
    const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return { ok: false, error: `Too many summaries — try again in ${retry}s.` };
  }

  // Re-derive the recommendations server-side under RLS — never trust client input.
  const today = new Date().toISOString().slice(0, 10);
  const view = await loadCompetencyRecommendations(identity, today);
  const top = view.recommendations.slice(0, TOP_N);
  if (top.length === 0) {
    return { ok: false, error: "No competencies to summarize yet." };
  }

  try {
    const { narrative, topPick } = await narrateRecommendations({
      top: top.map((r) => ({
        name: r.name,
        programType: r.programType,
        recommendationScore: r.recommendationScore,
        coveragePercent: r.coveragePercent,
        effectiveLean: r.effectiveLean,
      })),
      partnerType: view.profile.partnerType,
      industry: view.profile.industry,
      overallReadiness: null,
    });
    // Audit — counts + the chosen pick only, never the full reasoning. Best-effort.
    await withTenant(identity, (tx) =>
      tx.insert(auditLog).values({
        tenantId: identity.tenantId,
        actorUserId: identity.userId,
        action: "program.recommend_narrate",
        resourceType: "program",
        metadata: { topCount: top.length, topPick },
      }),
    ).catch(() => undefined);
    return { ok: true, narrative, topPick };
  } catch {
    return { ok: false, error: "Couldn't summarize the recommendations just now. Please try again." };
  }
}
