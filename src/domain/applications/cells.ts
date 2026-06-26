/**
 * Pure A1 cell-address helpers. Excel columns are 1-based letters (A, B, ..., Z,
 * AA, ...); we work internally in 0-based indices. No I/O — unit-tested.
 */

export function colToLetters(col: number): string {
  let n = col + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function lettersToCol(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/** 0-based (row, col) -> A1, e.g. (4, 3) -> "D5". */
export function toA1(row: number, col: number): string {
  return `${colToLetters(col)}${row + 1}`;
}

/** A1 -> 0-based, e.g. "D5" -> { row: 4, col: 3 }. */
export function fromA1(addr: string): { row: number; col: number } {
  const m = /^([A-Za-z]+)(\d+)$/.exec(addr.trim());
  if (!m) throw new Error(`Invalid A1 address: ${addr}`);
  return { col: lettersToCol(m[1]!), row: Number.parseInt(m[2]!, 10) - 1 };
}
