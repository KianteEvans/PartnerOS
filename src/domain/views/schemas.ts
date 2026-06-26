import { z } from "zod";
import { isKnownList } from "@/domain/views/saved";

/** Payload schemas for the saved-view actions. */

export const saveViewSchema = z.object({
  listKey: z.string().refine(isKnownList, "Unknown list"),
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
  // The normalized query string the list page produced. Bounded — these are
  // short filter/sort strings, never request bodies.
  query: z.string().max(500),
});

export const viewIdSchema = z.object({
  viewId: z.string().uuid("Invalid view id"),
});

export type SaveViewInput = z.infer<typeof saveViewSchema>;
