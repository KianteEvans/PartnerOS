/**
 * Pure, dependency-free parser for the AI narrative reply. The model is asked to
 * return a compact JSON object {narrative}; this extracts it defensively (tolerating
 * surrounding prose or a malformed body) and returns "" on failure so the caller can
 * fall back to the deterministic outline. Mirrors src/domain/copilot/parse.ts.
 */

export const MAX_NARRATIVE_CHARS = 4000;

export function parseNarrativeResponse(text: string): string {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const obj = JSON.parse(text.slice(start, end + 1)) as { narrative?: unknown };
      if (typeof obj.narrative === "string" && obj.narrative.trim().length > 0) {
        return obj.narrative.trim().slice(0, MAX_NARRATIVE_CHARS);
      }
    }
  } catch {
    // malformed JSON -> fall through to the empty sentinel
  }
  return "";
}
