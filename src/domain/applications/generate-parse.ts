/**
 * Pure, dependency-free parser for the AI control-response reply. The model is
 * asked for a compact JSON object {response, met, confidence, reasoning, cited};
 * this extracts it defensively and ALWAYS returns a safe result — a parse failure
 * or an unexpected `met` degrades to met="no" (never over-claim). Unit-tested
 * without the SDK.
 */

export type Met = "yes" | "no" | "partial";

export interface ControlDraft {
  readonly response: string;
  readonly met: Met;
  readonly confidence: number; // 0-100
  readonly reasoning: string;
  readonly citedEvidenceTitles: string[];
}

function toConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function toMet(v: unknown): Met {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "yes") return "yes";
  if (s === "partial") return "partial";
  return "no"; // fail-safe
}

export function parseControlDraft(text: string): ControlDraft {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const obj = JSON.parse(text.slice(start, end + 1)) as {
        response?: unknown;
        met?: unknown;
        confidence?: unknown;
        reasoning?: unknown;
        cited?: unknown;
      };
      const response = typeof obj.response === "string" ? obj.response.trim().slice(0, 4000) : "";
      const reasoning =
        typeof obj.reasoning === "string" && obj.reasoning.trim().length > 0
          ? obj.reasoning.trim().slice(0, 600)
          : "No reasoning provided.";
      const cited = Array.isArray(obj.cited)
        ? obj.cited.filter((c): c is string => typeof c === "string" && c.trim().length > 0).slice(0, 20)
        : [];
      return {
        response,
        met: toMet(obj.met),
        confidence: toConfidence(obj.confidence),
        reasoning,
        citedEvidenceTitles: cited,
      };
    }
  } catch {
    // malformed JSON -> safe fallback below
  }
  return {
    response: "",
    met: "no",
    confidence: 0,
    reasoning: "Could not parse the suggestion.",
    citedEvidenceTitles: [],
  };
}
