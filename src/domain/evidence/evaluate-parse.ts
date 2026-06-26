/**
 * Pure, dependency-free parser for the AI evidence-evaluator reply. The model is
 * asked to return a compact JSON object {confidence, reasoning}; this extracts it
 * defensively (tolerating surrounding prose, a numeric-string confidence, or a
 * malformed body) and ALWAYS returns a safe, clamped result — a parse failure
 * degrades to low confidence rather than throwing. Unit-tested without the SDK.
 */

export interface EvidenceEvaluation {
  readonly confidence: number; // 0-100
  readonly reasoning: string;
}

function toConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

export function parseEvaluation(text: string): EvidenceEvaluation {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const obj = JSON.parse(text.slice(start, end + 1)) as {
        confidence?: unknown;
        reasoning?: unknown;
      };
      const confidence = toConfidence(obj.confidence);
      const reasoning =
        typeof obj.reasoning === "string" && obj.reasoning.trim().length > 0
          ? obj.reasoning.trim().slice(0, 600)
          : "No assessment was returned.";
      return { confidence, reasoning };
    }
  } catch {
    // malformed JSON -> safe fallback below
  }
  return { confidence: 0, reasoning: "Could not parse the assessment." };
}
