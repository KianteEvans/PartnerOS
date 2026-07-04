import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { parseWinLossNarrative, type WinLossNarrative } from "@/domain/ace/winloss-ai-parse";
import type { WinLossReport } from "@/domain/ace/winloss";
import type { RepWinRow, StrengthSplit } from "@/domain/ace/winloss";

/**
 * Optional AI win/loss narrative — a grounded read-out of the COMPUTED mining report
 * (aggregates only; never row-level deal data). Configured the same way as the other
 * AI helpers: present ANTHROPIC_API_KEY or the feature stays hidden.
 */

export function isWinLossAiEnabled(): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.length > 0;
}

const SYSTEM_PROMPT = `You are an AWS partner-alliance analyst embedded in PartnerOS.
You are given a partner's computed win/loss mining report (aggregate statistics over their
closed AWS co-sell deals). Write a short, honest read-out of what drives their wins and
losses. Treat factor lifts as CORRELATION, not causation, and respect suppressed/low-sample
factors by not over-claiming. Be specific with the numbers you are given; do not invent any.
Respond with ONLY a compact JSON object and nothing else:
{"headline": "<one sentence>", "insights": ["<short actionable insight>", ...]} (2-4 insights).`;

export async function generateWinLossNarrative(input: {
  readonly report: WinLossReport;
  readonly reps: readonly RepWinRow[];
  readonly strength: StrengthSplit;
}): Promise<WinLossNarrative | null> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Win/loss AI narrative is not configured");

  // Grounding: computed aggregates only — no deal names beyond top-rep names.
  const grounding = JSON.stringify({
    overall: input.report.overall,
    bySource: input.report.bySource,
    bySizeBand: input.report.bySizeBand,
    lossReasons: input.report.lossReasons,
    factors: input.report.factors,
    topReps: input.reps.slice(0, 3).map((r) => ({ name: r.name, role: r.role, closed: r.closed, winRate: r.winRate })),
    strengthSplit: input.strength,
  });

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Win/loss report:\n${grounding}` }],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseWinLossNarrative(text);
}
