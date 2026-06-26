"use server";

import { and, eq } from "drizzle-orm";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { auditLog, evidence, programRequirements } from "@/db/schema";
import { evidenceEvalRateLimiter } from "@/redis/ratelimit";
import { evaluateEvidenceFit, isEvidenceEvalEnabled } from "@/domain/evidence/evaluate-client";

/**
 * Server action behind the optional "Evaluate with AI" button on a program
 * requirement. Read-only w.r.t. domain data (audit insert only), like askAwsAction,
 * so it does NOT go through the mutation gate. It reaches a paid external API, so it
 * requires a live session, is key-gated, rate-limited per user, loads the artifact +
 * requirement under RLS (never trusting client-supplied text), and audits the call
 * with counts only — never the artifact text.
 */

export interface EvaluateEvidenceState {
  ok: boolean;
  confidence?: number;
  reasoning?: string;
  error?: string;
}

export async function evaluateEvidenceAction(
  _prev: EvaluateEvidenceState,
  formData: FormData,
): Promise<EvaluateEvidenceState> {
  const identity = await tryGetServerIdentity();
  if (!identity) return { ok: false, error: "Sign in to evaluate evidence." };

  const evidenceId = String(formData.get("evidenceId") ?? "");
  const requirementId = String(formData.get("requirementId") ?? "");
  if (!evidenceId || !requirementId) {
    return { ok: false, error: "Missing evidence or requirement." };
  }
  if (!isEvidenceEvalEnabled()) {
    return { ok: false, error: "AI evaluation isn't configured. Set ANTHROPIC_API_KEY to enable it." };
  }

  // Per-user rate limit — each call hits a paid external API.
  const rl = await evidenceEvalRateLimiter.limit(`${identity.tenantId}:${identity.userId}`);
  if (!rl.success) {
    const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return { ok: false, error: `Too many evaluations — try again in ${retry}s.` };
  }

  // Load the artifact + requirement under RLS — never trust client-supplied text.
  const loaded = await withTenant(identity, async (tx) => {
    const [ev] = await tx
      .select({ title: evidence.title, notes: evidence.reviewNotes })
      .from(evidence)
      .where(and(eq(evidence.id, evidenceId), eq(evidence.tenantId, identity.tenantId)));
    const [req] = await tx
      .select({
        label: programRequirements.label,
        expectedEvidenceType: programRequirements.expectedEvidenceType,
      })
      .from(programRequirements)
      .where(
        and(
          eq(programRequirements.id, requirementId),
          eq(programRequirements.tenantId, identity.tenantId),
        ),
      );
    return { ev, req };
  });
  if (!loaded.ev || !loaded.req) {
    return { ok: false, error: "Evidence or requirement not found." };
  }

  try {
    const { confidence, reasoning } = await evaluateEvidenceFit({
      evidenceTitle: loaded.ev.title,
      evidenceNotes: loaded.ev.notes,
      requirementLabel: loaded.req.label,
      expectedEvidenceType: loaded.req.expectedEvidenceType,
    });
    // Audit — counts only, never the artifact text. Best-effort.
    await withTenant(identity, (tx) =>
      tx.insert(auditLog).values({
        tenantId: identity.tenantId,
        actorUserId: identity.userId,
        action: "evidence.ai_evaluate",
        resourceType: "evidence",
        resourceId: evidenceId,
        metadata: { confidence, requirementId },
      }),
    ).catch(() => undefined);
    return { ok: true, confidence, reasoning };
  } catch {
    return { ok: false, error: "Couldn't evaluate the evidence just now. Please try again." };
  }
}
