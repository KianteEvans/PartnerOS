/**
 * Pure, dependency-free parser for the AI competency-recommendation reply. The model
 * is asked to return a compact JSON object {narrative, topPick}; this extracts it
 * defensively (tolerating surrounding prose or a malformed body) and ALWAYS returns a
 * safe result — a parse failure degrades to an empty narrative rather than throwing.
 * Unit-tested without the SDK.
 */

export interface RecommendNarrative {
  readonly narrative: string;
  readonly topPick: string | null;
}

export function parseNarrative(text: string): RecommendNarrative {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const obj = JSON.parse(text.slice(start, end + 1)) as {
        narrative?: unknown;
        topPick?: unknown;
      };
      const narrative =
        typeof obj.narrative === "string" && obj.narrative.trim().length > 0
          ? obj.narrative.trim().slice(0, 800)
          : "No summary was returned.";
      const topPick =
        typeof obj.topPick === "string" && obj.topPick.trim().length > 0
          ? obj.topPick.trim().slice(0, 120)
          : null;
      return { narrative, topPick };
    }
  } catch {
    // malformed JSON -> safe fallback below
  }
  return { narrative: "Could not parse the summary.", topPick: null };
}
