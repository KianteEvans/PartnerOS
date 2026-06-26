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
