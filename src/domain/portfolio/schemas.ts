import { z } from "zod";

/** Provision a brand-new managed workspace (agency owns it from birth). Optional
 *  `initialUsers` seed pending invitations for the customer's team at creation. */
export const createManagedWorkspaceSchema = z.object({
  name: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(1).max(120)),
  initialUsers: z
    .array(
      z.object({
        email: z.preprocess(
          (v) => (typeof v === "string" ? v.trim().toLowerCase() : ""),
          z.string().min(3).max(200).email(),
        ),
        role: z.enum(["admin", "manager", "member", "viewer"]),
      }),
    )
    .max(25)
    .default([]),
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

/** Set a managed customer workspace's service package. The three literals mirror
 *  PACKAGE_TIERS in domain/packaging/catalog (the single source of truth). */
export const setCustomerPlanSchema = z.object({
  workspaceId: z.string().uuid(),
  plan: z.enum(["essentials", "growth", "enterprise"]),
});
export type SetCustomerPlanInput = z.infer<typeof setCustomerPlanSchema>;
