import { z } from "zod";
import { parseOrThrow } from "@/domain/forms";

/**
 * Shared parsing for bulk-action bars: the selection bar submits the chosen row
 * ids as a JSON array in an `ids` field. Bounded so one click can't fan out into
 * an unbounded UPDATE.
 */
const bulkIdsSchema = z
  .array(z.string().uuid())
  .min(1, "No rows selected")
  .max(200, "Too many rows selected at once (max 200)");

export function parseBulkIds(raw: FormDataEntryValue | null): string[] {
  let arr: unknown;
  try {
    arr = JSON.parse(typeof raw === "string" ? raw : "[]");
  } catch {
    arr = [];
  }
  return parseOrThrow(bulkIdsSchema, arr);
}
