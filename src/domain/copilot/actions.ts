"use server";

import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { auditLog } from "@/db/schema";
import { copilotRateLimiter } from "@/redis/ratelimit";
import { loadCommandData } from "@/domain/command/load";
import { buildCommandCenter } from "@/domain/command/aggregate";
import { tierPath } from "@/domain/tiers/path";
import { TIER_LABELS, type TierId } from "@/domain/tiers/catalog";
import { compileWorkspaceBrief } from "@/domain/copilot/brief";
import { askCopilot, isCopilotEnabled } from "@/domain/copilot/client";
import { parseHistory, type CopilotTurn } from "@/domain/copilot/history";

/**
 * Server action behind the Alliance Copilot box on the Command Center. Read-only w.r.t.
 * domain data (audit insert only), so it does NOT go through the mutation gate. It reaches
 * a paid external API, so it requires a live session, is key-gated, rate-limited per user,
 * and RE-DERIVES its grounding server-side under RLS — the compiled workspace brief is
 * built from freshly-loaded data, never from anything the client sent. The transcript the
 * island resends is conversational context only (parsed defensively, clamped, capped);
 * the brief the model answers from is rebuilt fresh on every turn. The audit records
 * counts only (question length, turn count, next-action count, health score) — never the
 * question or answer text.
 */

export interface CopilotState {
  ok: boolean;
  turns: CopilotTurn[];
  reasoning?: string;
  nextActions?: string[];
  truncated?: boolean;
  error?: string;
}

function tierLabel(id: string): string {
  return TIER_LABELS[id as TierId] ?? id;
}

export async function askAllianceCopilot(_prev: CopilotState, formData: FormData): Promise<CopilotState> {
  const identity = await tryGetServerIdentity();
  if (!identity) return { ok: false, turns: [], error: "Sign in to ask the Alliance Copilot." };

  // "New conversation" — drop the transcript, back to the idle state.
  if ((formData.get("reset") ?? "").toString() === "1") return { ok: false, turns: [] };

  const history = parseHistory((formData.get("history") ?? "").toString());
  const turns = [...history.turns];

  if (!isCopilotEnabled()) {
    return { ok: false, turns, error: "The Alliance Copilot isn't configured. Set ANTHROPIC_API_KEY to enable it." };
  }

  // A follow-up chip (name="chip") takes precedence over the free-text box.
  const chip = formData.get("chip");
  const question = ((chip ?? formData.get("question")) ?? "").toString().trim();
  if (question.length < 10) return { ok: false, turns, error: "Ask a fuller question (at least 10 characters)." };
  if (question.length > 2000) return { ok: false, turns, error: "That question is too long — keep it under 2000 characters." };

  const rl = await copilotRateLimiter.limit(`${identity.tenantId}:${identity.userId}`);
  if (!rl.success) {
    const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return { ok: false, turns, error: `Too many questions — try again in ${retry}s.` };
  }

  // Re-derive the live workspace brief server-side under RLS — never trust client input.
  const today = new Date().toISOString().slice(0, 10);
  const { inputs } = await loadCommandData(identity);
  const cc = buildCommandCenter(inputs, today);
  const currentTier = inputs.tier ? inputs.tier.currentTier : inputs.currentTier;
  const targetTier = inputs.tier ? inputs.tier.targetTier : inputs.currentTier;
  const path = inputs.tier ? tierPath(inputs.tierRequirements, today, tierLabel(targetTier)) : null;
  const brief = compileWorkspaceBrief(cc, path, tierLabel(currentTier), tierLabel(targetTier), today);

  try {
    const answer = await askCopilot({ question, brief, history: history.turns });
    // Audit — counts only, never the question or answer text. Best-effort.
    await withTenant(identity, (tx) =>
      tx.insert(auditLog).values({
        tenantId: identity.tenantId,
        actorUserId: identity.userId,
        action: "copilot.query",
        resourceType: "command",
        metadata: {
          questionLength: question.length,
          turnCount: history.turns.length + 1,
          nextActionCount: answer.nextActions.length,
          healthScore: cc.health.score,
        },
      }),
    ).catch(() => undefined);
    return {
      ok: true,
      turns: [...turns, { q: question, a: answer.answer }],
      reasoning: answer.reasoning,
      nextActions: answer.nextActions,
      ...(history.truncated ? { truncated: true } : {}),
    };
  } catch {
    return { ok: false, turns, error: "The Alliance Copilot couldn't answer just now. Please try again." };
  }
}
