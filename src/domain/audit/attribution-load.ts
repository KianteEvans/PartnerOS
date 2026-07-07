import { inArray } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { tenants, users } from "@/db/schema";
import type { OperatorRef } from "@/domain/audit/attribution";

/**
 * Server loader for agency act-as attribution (companion to the pure
 * attribution.ts). Resolves the distinct operator + agency ids gathered from
 * act-as audit rows into emails + agency names.
 *
 * Cross-tenant by nature — the operator and the agency live in the AGENCY
 * tenant, not the workspace being audited — so it runs via `withSystem`. This is
 * safe: the ids are opaque uuids already surfaced by the tenant-scoped audit
 * query (RLS is not widened), and revealing "who from the agency acted here" to
 * that workspace's admins is exactly the accountability we want.
 */

export interface AttributionMaps {
  readonly operatorEmailById: ReadonlyMap<string, string>;
  readonly agencyNameById: ReadonlyMap<string, string>;
}

const EMPTY: AttributionMaps = { operatorEmailById: new Map(), agencyNameById: new Map() };

export async function loadAttribution(refs: readonly OperatorRef[]): Promise<AttributionMaps> {
  if (refs.length === 0) return EMPTY;
  const operatorIds = [...new Set(refs.map((r) => r.operatorId))];
  const agencyIds = [...new Set(refs.map((r) => r.agencyId))];
  return withSystem(async (tx) => {
    const ops = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, operatorIds));
    const ags = await tx
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(inArray(tenants.id, agencyIds));
    return {
      operatorEmailById: new Map(ops.map((o) => [o.id, o.email] as const)),
      agencyNameById: new Map(ags.map((a) => [a.id, a.name] as const)),
    };
  });
}
