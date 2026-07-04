/**
 * Small, pure ISO-date helpers shared across domains. Dates are handled as
 * `YYYY-MM-DD` strings (matching Postgres `date` columns), which sort and
 * compare lexicographically and keep the logic deterministic and timezone-free.
 */

/** Add `n` days to an ISO date string, returning a new ISO date string. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Add `n` whole months to an ISO date string (clamping is left to the caller). */
export function addMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative if `to` precedes `from`). */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * A compact "time ago" label for a timestamp, from epoch millis (both args), so it
 * keeps sub-day resolution the `YYYY-MM-DD` helpers above discard — freshness strips
 * want "4h ago", not "today". Clock-free/deterministic: the caller passes `nowMs`.
 * Buckets: <1m → "just now"; <1h → "Nm ago"; <1d → "Nh ago"; <7d → "Nd ago";
 * otherwise the ISO date. A future timestamp clamps to "just now".
 */
export function relativeTime(fromMs: number, nowMs: number): string {
  const diff = nowMs - fromMs;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(fromMs).toISOString().slice(0, 10);
}
