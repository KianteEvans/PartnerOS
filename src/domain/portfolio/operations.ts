import { and, eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { tenants, agencyLinkRequests, onboarding } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError, ForbiddenError } from "@/http/errors";
import { ensureAgencyServiceUser } from "@/auth/agency";

/**
 * Agency / portfolio write operations (Bet C). Two flavors:
 *  - Cross-tenant creates (provision a new managed workspace, request a link) touch a
 *    FOREIGN tenant, so they run via `withSystem` with an explicit `is_agency` check.
 *  - Approve / reject run inside the TARGET owner's own tenant tx (`ctx.tx`): setting
 *    your own `agency_id`, inserting the agency's service user into your tenant, and
 *    updating your own incoming request all pass ordinary RLS.
 */

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "workspace";
}

/** Provision a brand-new workspace owned by the calling agency from birth. */
export async function createManagedWorkspaceOp(
  { identity }: MutationContext,
  input: { readonly name: string },
): Promise<{ tenantId: string }> {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Workspace name is required");
  return withSystem(async (tx) => {
    const [agency] = await tx
      .select({ isAgency: tenants.isAgency })
      .from(tenants)
      .where(eq(tenants.id, identity.tenantId))
      .limit(1);
    if (!agency?.isAgency) throw new ForbiddenError("Only an agency can create managed workspaces");

    // Ensure a unique slug.
    const base = slugify(name);
    let slug = base;
    for (let n = 2; ; n++) {
      const [clash] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);
      if (!clash) break;
      slug = `${base}-${n}`;
    }

    const [child] = await tx
      .insert(tenants)
      .values({ name, slug, agencyId: identity.tenantId })
      .returning({ id: tenants.id });
    await ensureAgencyServiceUser(tx, identity.tenantId, child!.id);
    // Agency-provisioned workspaces skip onboarding (the agency owns them) so their
    // home hub renders immediately when the operator acts-as.
    await tx.insert(onboarding).values({ tenantId: child!.id, status: "completed" });
    return { tenantId: child!.id };
  });
}

/** Request to manage an existing workspace by slug — creates a pending consent row. */
export async function requestLinkOp(
  { identity }: MutationContext,
  input: { readonly slug: string },
): Promise<{ requestId: string }> {
  const slug = input.slug.trim().toLowerCase();
  if (!slug) throw new ValidationError("Workspace slug is required");
  return withSystem(async (tx) => {
    const [agency] = await tx
      .select({ isAgency: tenants.isAgency })
      .from(tenants)
      .where(eq(tenants.id, identity.tenantId))
      .limit(1);
    if (!agency?.isAgency) throw new ForbiddenError("Only an agency can request to manage workspaces");

    const [target] = await tx
      .select({ id: tenants.id, isAgency: tenants.isAgency, agencyId: tenants.agencyId })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    if (!target) throw new ValidationError("No workspace with that slug");
    if (target.id === identity.tenantId) throw new ValidationError("An agency cannot manage itself");
    if (target.isAgency) throw new ValidationError("That workspace is itself an agency");
    if (target.agencyId) throw new ValidationError("That workspace is already managed by an agency");

    // Collapse duplicate pending requests.
    const [dup] = await tx
      .select({ id: agencyLinkRequests.id })
      .from(agencyLinkRequests)
      .where(
        and(
          eq(agencyLinkRequests.agencyTenantId, identity.tenantId),
          eq(agencyLinkRequests.targetTenantId, target.id),
          eq(agencyLinkRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (dup) return { requestId: dup.id };

    const [req] = await tx
      .insert(agencyLinkRequests)
      .values({
        agencyTenantId: identity.tenantId,
        targetTenantId: target.id,
        requestedBy: identity.userId,
        status: "pending",
      })
      .returning({ id: agencyLinkRequests.id });
    return { requestId: req!.id };
  });
}

/** Approve an incoming link request (target owner). Runs in the target's own tenant tx. */
export async function approveLinkOp(
  { identity, tx }: MutationContext,
  input: { readonly requestId: string },
): Promise<{ agencyTenantId: string }> {
  const [req] = await tx
    .select()
    .from(agencyLinkRequests)
    .where(eq(agencyLinkRequests.id, input.requestId))
    .limit(1);
  if (!req || req.targetTenantId !== identity.tenantId || req.status !== "pending") {
    throw new ValidationError("No pending request");
  }
  const [self] = await tx
    .select({ isAgency: tenants.isAgency, agencyId: tenants.agencyId })
    .from(tenants)
    .where(eq(tenants.id, identity.tenantId))
    .limit(1);
  if (self?.isAgency) throw new ValidationError("An agency cannot be managed by another agency");
  if (self?.agencyId) throw new ValidationError("This workspace is already managed by an agency");

  await tx.update(tenants).set({ agencyId: req.agencyTenantId }).where(eq(tenants.id, identity.tenantId));
  await ensureAgencyServiceUser(tx, req.agencyTenantId, identity.tenantId);
  await tx
    .update(agencyLinkRequests)
    .set({ status: "approved", decidedAt: new Date(), decidedBy: identity.userId })
    .where(eq(agencyLinkRequests.id, req.id));
  return { agencyTenantId: req.agencyTenantId };
}

/** Reject an incoming link request (target owner). */
export async function rejectLinkOp(
  { identity, tx }: MutationContext,
  input: { readonly requestId: string },
): Promise<{ ok: true }> {
  const [req] = await tx
    .select()
    .from(agencyLinkRequests)
    .where(eq(agencyLinkRequests.id, input.requestId))
    .limit(1);
  if (!req || req.targetTenantId !== identity.tenantId || req.status !== "pending") {
    throw new ValidationError("No pending request");
  }
  await tx
    .update(agencyLinkRequests)
    .set({ status: "rejected", decidedAt: new Date(), decidedBy: identity.userId })
    .where(eq(agencyLinkRequests.id, req.id));
  return { ok: true };
}
