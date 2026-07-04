import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { parseCopilotAnswer, type CopilotAnswer } from "@/domain/copilot/parse";
import type { CopilotTurn } from "@/domain/copilot/history";

/**
 * Server-only client for the Alliance Copilot — a strategic Q&A assistant grounded in
 * the partner's LIVE cross-domain workspace. The caller compiles a deterministic
 * `compileWorkspaceBrief` (health, decision queue, next-best-actions, tier ETA, progress)
 * and passes it here with the user's question; Claude answers ONLY from that brief.
 * Optional + key-gated like the other AI helpers (missing key → the feature is disabled,
 * never a crash). Never imported by client code.
 */

export function isCopilotEnabled(): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
}

const SYSTEM_PROMPT = `You are the Alliance Copilot inside PartnerOS — a strategic assistant for an AWS Partner's alliance team. You are given a compact, factual brief of the partner's LIVE workspace (partnership health and its drivers, the current decision/risk queue, the highest-leverage next moves with their projected impact, tier-advancement status and ETA, and program/task progress) plus one question.

Answer ONLY from the brief. Cite specific items by name (a decision, a next move, a tier requirement) when relevant. Never invent programs, tiers, requirements, dates, or numbers that are not in the brief. If the brief lacks what's needed, say so plainly and suggest what to look at. Be concrete, prioritized, and concise — an alliance director should be able to act on the answer immediately.

Respond with ONLY a compact JSON object and nothing else: {"answer": "<2-5 sentence direct answer>", "reasoning": "<1-2 sentences on why, grounded in the brief>", "nextActions": ["<imperative next step>", "..."]}. Include at most 5 nextActions, each a short imperative phrase.

You may also receive earlier turns of this conversation. Treat them as conversational context for follow-up questions, but the WORKSPACE BRIEF in the LATEST message is the current state of the workspace — when an earlier turn conflicts with it, the latest brief wins.`;

export interface AskCopilotInput {
  readonly question: string;
  readonly brief: string;
  readonly history: readonly CopilotTurn[];
}

export async function askCopilot(input: AskCopilotInput): Promise<CopilotAnswer> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Alliance Copilot is not configured");

  const client = new Anthropic({ apiKey });
  // Prior turns are resent as conversation; assistant turns keep the compact-JSON shape
  // (answer only) so the output-format exemplar stays consistent without resending
  // reasoning/nextActions. The FRESH brief rides only on the newest question.
  const messages: Anthropic.MessageParam[] = [
    ...input.history.flatMap((t): Anthropic.MessageParam[] => [
      { role: "user", content: t.q },
      { role: "assistant", content: JSON.stringify({ answer: t.a }) },
    ]),
    { role: "user", content: `WORKSPACE BRIEF\n${input.brief}\n\nQUESTION\n${input.question}` },
  ];

  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages,
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseCopilotAnswer(text);
}
