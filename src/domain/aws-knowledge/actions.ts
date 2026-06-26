"use server";

import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { auditLog } from "@/db/schema";
import { aiAssistantRateLimiter } from "@/redis/ratelimit";
import { askAwsKnowledge, isAwsKnowledgeEnabled } from "@/domain/aws-knowledge/client";
import type { Citation } from "@/domain/aws-knowledge/parse";

/**
 * Server action behind the "Ask AWS" panel. Read-only (no DB writes via the gate):
 * any authenticated member may use it. It reaches a paid external API + egresses the
 * question to Anthropic/AWS, so it requires a live session, bounds the input,
 * rate-limits per user, and writes an audit row (length/counts only) per query.
 */

export interface AskAwsState {
  ok: boolean;
  answer?: string;
  citations?: readonly Citation[];
  toolCalls?: number;
  error?: string;
}

export async function askAwsAction(_prev: AskAwsState, formData: FormData): Promise<AskAwsState> {
  const identity = await tryGetServerIdentity();
  if (!identity) return { ok: false, error: "Sign in to use the AWS assistant." };

  const question = String(formData.get("question") ?? "").trim();
  if (question.length < 5) return { ok: false, error: "Ask a question (at least 5 characters)." };
  if (question.length > 1000) {
    return { ok: false, error: "That question is too long (1000 characters max)." };
  }
  if (!isAwsKnowledgeEnabled()) {
    return { ok: false, error: "The AWS assistant isn't configured. Set ANTHROPIC_API_KEY to enable it." };
  }

  // Per-user rate limit — each call hits a paid external API.
  const rl = await aiAssistantRateLimiter.limit(`${identity.tenantId}:${identity.userId}`);
  if (!rl.success) {
    const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return { ok: false, error: `Too many questions — try again in ${retry}s.` };
  }

  try {
    const { answer, citations, toolCalls } = await askAwsKnowledge(question);
    // Audit the query — length + counts only, never the question text. Best-effort:
    // a failed audit write must not fail the user's answer.
    await withTenant(identity, (tx) =>
      tx.insert(auditLog).values({
        tenantId: identity.tenantId,
        actorUserId: identity.userId,
        action: "aws_knowledge.query",
        resourceType: "aws_knowledge",
        metadata: { questionLength: question.length, toolCalls, citations: citations.length },
      }),
    ).catch(() => undefined);
    return {
      ok: true,
      answer: answer || "AWS Knowledge didn't return an answer for that — try rephrasing.",
      citations,
      toolCalls,
    };
  } catch {
    return { ok: false, error: "Couldn't reach AWS Knowledge just now. Please try again." };
  }
}
