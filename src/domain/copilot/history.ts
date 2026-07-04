/**
 * Pure helpers for the Alliance Copilot's multi-turn transcript. The conversation lives
 * client-side (island state) and is resent with each question as a JSON form field; the
 * server NEVER treats it as ground truth — it is conversational context only, parsed
 * defensively here (malformed input degrades to an empty history) and clamped so a
 * hostile payload cannot inflate the prompt. The live workspace brief is re-derived
 * fresh on every turn regardless of what the history claims.
 */

export interface CopilotTurn {
  readonly q: string;
  readonly a: string;
}

/** Prior turns resent to the model per request (each turn becomes 2 messages). */
export const MAX_TURNS = 6;

/** Longest question/answer kept per resent turn — matches the single-turn clamps. */
const MAX_TURN_CHARS = 2000;

export interface ParsedHistory {
  readonly turns: readonly CopilotTurn[];
  readonly truncated: boolean;
}

export function parseHistory(raw: string | null | undefined): ParsedHistory {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { turns: [], truncated: false };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { turns: [], truncated: false };
  }
  if (!Array.isArray(data)) return { turns: [], truncated: false };

  const clean: CopilotTurn[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const q = (entry as { q?: unknown }).q;
    const a = (entry as { a?: unknown }).a;
    if (typeof q !== "string" || typeof a !== "string") continue;
    const turn = { q: q.trim().slice(0, MAX_TURN_CHARS), a: a.trim().slice(0, MAX_TURN_CHARS) };
    if (turn.q.length === 0 || turn.a.length === 0) continue;
    clean.push(turn);
  }

  const turns = clean.slice(-MAX_TURNS);
  return { turns, truncated: clean.length > turns.length };
}
