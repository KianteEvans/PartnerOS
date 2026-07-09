import { and, eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import type { TenantDb } from "@/db/client";
import { tenants, users } from "@/db/schema";
import { ForbiddenError } from "@/http/errors";

/**
 * Agency / portfolio helpers (Bet C). Cross-tenant reads/writes here run via
 * `withSystem` (RLS-bypass owner) with an explicit authorization check — the same
 * trust model as the existing provisioning + cron code. The security crux is
 * `assertManages`: an agency operator may only ever touch a workspace whose
 * `agency_id` points back at their own tenant.
 */

/** The deterministic identity of the shared "agency service user" inside a child. */
const agencySubject = (agencyTid: string): string => `agency:${agencyTid}`;
const agencyEmail = (agencyTid: string): string => `agency-${agencyTid}@managed.partneros.local`;

export interface TenantMeta {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly isAgency: boolean;
  readonly agencyId: string | null;
}

export async function loadTenantMeta(tenantId: string): Promise<TenantMeta | null> {
  return withSystem(async (tx) => {
    const [t] = await tx
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        isAgency: tenants.isAgency,
        agencyId: tenants.agencyId,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return t ?? null;
  });
}

/** Throw ForbiddenError unless `childTid` is a workspace managed by `agencyTid`. */
export async function assertManages(agencyTid: string, childTid: string): Promise<void> {
  const child = await loadTenantMeta(childTid);
  if (!child || child.agencyId !== agencyTid) {
    throw new ForbiddenError("Workspace is not managed by this agency");
  }
}

export interface ServiceUser {
  readonly id: string;
  readonly epoch: number;
}

/**
 * Idempotently ensure a shared "agency service user" (a delegated admin) exists in
 * the child tenant, representing the agency. Returns its id + session epoch (for
 * minting an act-as session). MUST run inside a `withSystem` tx (it writes across a
 * tenant boundary). The email is synthetic + deterministic so it never collides with
 * a real member.
 */
export async function ensureAgencyServiceUser(
  tx: TenantDb,
  agencyTid: string,
  childTid: string,
): Promise<ServiceUser> {
  // Fail-closed: re-verify the management link INSIDE the caller's transaction, so a
  // concurrent unlink between a route-level check and this mint can never produce a
  // service user (and therefore an act-as session) for a workspace the agency no
  // longer manages (TOCTOU).
  const [child] = await tx
    .select({ agencyId: tenants.agencyId })
    .from(tenants)
    .where(eq(tenants.id, childTid))
    .limit(1);
  if (!child || child.agencyId !== agencyTid) {
    throw new ForbiddenError("Workspace is not managed by this agency");
  }
  const sub = agencySubject(agencyTid);
  const [existing] = await tx
    .select({ id: users.id, epoch: users.sessionEpoch })
    .from(users)
    .where(and(eq(users.tenantId, childTid), eq(users.oidcSubject, sub)))
    .limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(users)
    .values({
      tenantId: childTid,
      oidcSubject: sub,
      email: agencyEmail(agencyTid),
      role: "admin",
      status: "active",
    })
    .returning({ id: users.id, epoch: users.sessionEpoch });
  return created!;
}
