/**
 * Pure, dependency-free parser for the attribution-advisor AI reply. The model is
 * asked for a compact JSON object {headline, advice[]}; this extracts it defensively
 * (tolerating surrounding prose or a malformed body) and returns null on failure so
 * the caller can surface a retry message. Mirrors src/domain/ace/winloss-ai-parse.ts.
 */

export interface AttributionAdvice {
  readonly headline: string;
  readonly advice: readonly string[];
}

export function parseAttributionAdvice(text: string): AttributionAdvice | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const obj = JSON.parse(text.slice(start, end + 1)) as { headline?: unknown; advice?: unknown };
      const headline =
        typeof obj.headline === "string" && obj.headline.trim().length > 0
          ? obj.headline.trim().slice(0, 300)
          : "";
      const advice = Array.isArray(obj.advice)
        ? obj.advice
            .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
            .map((a) => a.trim().slice(0, 240))
            .slice(0, 5)
        : [];
      if (headline.length > 0 && advice.length > 0) return { headline, advice };
    }
  } catch {
    // malformed JSON -> null below
  }
  return null;
}
