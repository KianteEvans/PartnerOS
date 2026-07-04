"use server";

import { and, asc, eq } from "drizzle-orm";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { auditLog, roadmaps, roadmapMilestones } from "@/db/schema";
import { roadmapNarrativeRateLimiter } from "@/redis/ratelimit";
import { targetTierFromMilestones, tierCoverage } from "@/domain/roadmaps/coverage";
import { thresholdsForTier, TIER_LABELS } from "@/domain/tiers/catalog";
import { loadRoadmapRecommendations } from "@/domain/roadmaps/recommend-load";
import { narrateRoadmap, isRoadmapNarrativeEnabled } from "@/domain/roadmaps/narrate-client";

/**
 * Server action behind the optional "Summarize with AI" button on the roadmap
 * detail page. Read-only w.r.t. domain data (audit insert only), so it does NOT go
 * through the mutation gate. It reaches a paid external API, so it requires a live
 * session, is key-gated, rate-limited per user, and RE-DERIVES its inputs
 * server-side under RLS (the roadmap's milestones, tier coverage, and top program
 * recommendations) — never trusting the client form beyond the roadmap id. The audit
 * records counts only — never the narrative contents.
 */

export interface RoadmapNarrativeState {
  ok: boolean;
  narrative?: string;
  topPick?: string | null;
  error?: string;
}

const TOP_N = 3;

export async function roadmapNarrativeAction(
  _prev: RoadmapNarrativeState,
  formData: FormData,
): Promise<RoadmapNarrativeState> {
  const identity = await tryGetServerIdentity();
  if (!identity) return { ok: false, error: "Sign in to summarize this roadmap." };

  if (!isRoadmapNarrativeEnabled()) {
    return { ok: false, error: "AI summary isn't configured. Set ANTHROPIC_API_KEY to enable it." };
  }

  const roadmapId = String(formData.get("roadmapId") ?? "");
  if (!roadmapId) return { ok: false, error: "Missing roadmap." };

  const rl = await roadmapNarrativeRateLimiter.limit(`${identity.tenantId}:${identity.userId}`);
  if (!rl.success) {
    const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return { ok: false, error: `Too many summaries — try again in ${retry}s.` };
  }

  // Re-derive the roadmap + milestones server-side under RLS — never trust the client.
  const data = await withTenant(identity, async (tx) => {
    const [roadmap] = await tx
      .select({ id: roadmaps.id, name: roadmaps.name })
      .from(roadmaps)
      .where(and(eq(roadmaps.id, roadmapId), eq(roadmaps.tenantId, identity.tenantId)));
    if (!roadmap) return null;
    const milestones = await tx
      .select({
        title: roadmapMilestones.title,
        status: roadmapMilestones.status,
        targetDate: roadmapMilestones.targetDate,
        originKind: roadmapMilestones.originKind,
        originRef: roadmapMilestones.originRef,
      })
      .from(roadmapMilestones)
      .where(
        and(eq(roadmapMilestones.roadmapId, roadmapId), eq(roadmapMilestones.tenantId, identity.tenantId)),
      )
      .orderBy(asc(roadmapMilestones.sequence));
    return { roadmap, milestones };
  });
  if (!data) return { ok: false, error: "Roadmap not found." };
  if (data.milestones.length === 0) return { ok: false, error: "Add milestones before summarizing." };

  const today = new Date().toISOString().slice(0, 10);
  const targetTier = targetTierFromMilestones(data.milestones);
  const cov = targetTier ? tierCoverage(data.milestones, thresholdsForTier(targetTier), targetTier) : null;
  const recView = await loadRoadmapRecommendations(
    identity,
    today,
    new Set(
      data.milestones.filter((m) => m.originKind === "program" && m.originRef).map((m) => m.originRef),
    ),
  );
  const top = recView.recommendations.slice(0, TOP_N);

  try {
    const { narrative, topPick } = await narrateRoadmap({
      roadmapName: data.roadmap.name,
      targetTier: targetTier ? TIER_LABELS[targetTier] : null,
      coveragePercent: cov ? cov.percent : null,
      milestones: data.milestones.map((m) => ({
        title: m.title,
        status: m.status,
        targetDate: m.targetDate,
      })),
      recommendations: top.map((r) => ({ name: r.name, programType: r.programType, score: r.score })),
    });
    // Audit — counts + the chosen pick only, never the narrative text. Best-effort.
    await withTenant(identity, (tx) =>
      tx.insert(auditLog).values({
        tenantId: identity.tenantId,
        actorUserId: identity.userId,
        action: "roadmap.narrate",
        resourceType: "roadmap",
        metadata: { milestones: data.milestones.length, topPick },
      }),
    ).catch(() => undefined);
    return { ok: true, narrative, topPick };
  } catch {
    return { ok: false, error: "Couldn't summarize the roadmap just now. Please try again." };
  }
}
