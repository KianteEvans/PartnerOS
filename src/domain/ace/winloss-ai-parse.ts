/**
 * Defensive parser for the AI win/loss narrative. The model is asked for compact JSON
 * {"headline": "...", "insights": ["...", ...]}; anything malformed degrades to a safe
 * fallback instead of throwing. Pure and unit-testable.
 */

export interface WinLossNarrative {
  readonly headline: string;
  readonly insights: readonly string[];
}

const MAX_HEADLINE = 200;
const MAX_INSIGHT = 400;
const MAX_INSIGHTS = 5;

export function parseWinLossNarrative(text: string): WinLossNarrative | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const obj = JSON.parse(text.slice(start, end + 1)) as { headline?: unknown; insights?: unknown };
    const headline =
      typeof obj.headline === "string" && obj.headline.trim().length > 0
        ? obj.headline.trim().slice(0, MAX_HEADLINE)
        : null;
    const insights = Array.isArray(obj.insights)
      ? obj.insights
          .filter((i): i is string => typeof i === "string" && i.trim().length > 0)
          .map((i) => i.trim().slice(0, MAX_INSIGHT))
          .slice(0, MAX_INSIGHTS)
      : [];
    if (!headline && insights.length === 0) return null;
    return { headline: headline ?? "Win/loss read-out", insights };
  } catch {
    return null;
  }
}
