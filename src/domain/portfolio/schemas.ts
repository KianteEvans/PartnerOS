import { z } from "zod";

/** Provision a brand-new managed workspace (agency owns it from birth). */
export const createManagedWorkspaceSchema = z.object({
  name: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(1).max(120)),
});
export type CreateManagedWorkspaceInput = z.infer<typeof createManagedWorkspaceSchema>;

/** Request to manage an EXISTING workspace, identified by its slug (consent required). */
export const requestLinkSchema = z.object({
  slug: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : ""),
    z.string().min(1).max(80),
  ),
});
export type RequestLinkInput = z.infer<typeof requestLinkSchema>;

/** Approve/reject an incoming link request (target owner side). */
export const linkRequestSchema = z.object({ requestId: z.string().uuid() });
export type LinkRequestInput = z.infer<typeof linkRequestSchema>;
