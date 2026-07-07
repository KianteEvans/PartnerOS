import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { tenants } from "@/db/schema";
import { tryGetServerIdentity } from "@/auth/session";
import {
  PACKAGE_TIERS,
  isIncluded,
  lowerOf,
  type FeatureKey,
  type PackageTier,
} from "@/domain/packaging/catalog";

/**
 * Service-package entitlement resolution.
 *
 * The REAL entitlement is `tenants.plan` (drizzle/0059) — per workspace, set by
 * OBP. On top of it sits an optional per-user PREVIEW cookie: a demo/QA lens
 * that lets an admin view the app as a LOWER tier. The cookie can only ever
 * downgrade (see effectivePackageTier); it never grants more than the workspace
 * is entitled to. `packageFenceFor` — the gate every page already calls — now
 * resolves this effective tier instead of just reading the cookie.
 */

export const PREVIEW_COOKIE = "partneros_package_preview";
export const PREVIEW_MAX_AGE_SECONDS = 8 * 60 * 60;

/** The tier being previewed via the per-user cookie, or null when unset. */
export async function getPackagePreview(): Promise<PackageTier | null> {
  const jar = await cookies();
  const raw = jar.get(PREVIEW_COOKIE)?.value;
  return (PACKAGE_TIERS as readonly string[]).includes(raw ?? "") ? (raw as PackageTier) : null;
}

/**
 * The workspace's REAL, persisted entitlement (tenants.plan). Read via
 * `withSystem` — a cross-cutting infra lookup, the same trust model as
 * loadTenantMeta — and `cache()`-wrapped so it costs ONE indexed lookup per
 * request no matter how many pages/panels resolve it. Signed-out or an unknown
 * value falls back to 'enterprise' (fence nothing).
 *
 * When an agency operator is acting INSIDE a managed workspace, identity.tenantId
 * is the child's, so this returns the CUSTOMER's plan — the operator experiences
 * exactly the tier the customer is entitled to. (To instead give operators the
 * full platform inside lower-tier customers, exempt identity.actingAs here.)
 */
export const currentWorkspacePlan = cache(async (): Promise<PackageTier> => {
  const identity = await tryGetServerIdentity();
  if (!identity) return "enterprise";
  const [row] = await withSystem((tx) =>
    tx
      .select({ plan: tenants.plan })
      .from(tenants)
      .where(eq(tenants.id, identity.tenantId))
      .limit(1),
  );
  const plan = row?.plan;
  return (PACKAGE_TIERS as readonly string[]).includes(plan ?? "") ? (plan as PackageTier) : "enterprise";
});

/**
 * The tier the app should ACTUALLY enforce this request: the real plan, clamped
 * DOWN by the preview cookie when present. `lowerOf` makes an over-tier preview a
 * no-op, so preview can never unlock more than the workspace has paid for.
 */
export const effectivePackageTier = cache(async (): Promise<PackageTier> => {
  const real = await currentWorkspacePlan();
  const preview = await getPackagePreview();
  return preview ? lowerOf(preview, real) : real;
});

/**
 * Page gate: returns the effective tier when `feature` is OUTSIDE it (the page
 * should render <PackageFence/>), or null when the page renders normally. The
 * signature is unchanged, so every calling page is untouched — but it now
 * resolves the real per-workspace entitlement, not just the preview cookie.
 */
export async function packageFenceFor(feature: FeatureKey): Promise<PackageTier | null> {
  const tier = await effectivePackageTier();
  return isIncluded(tier, feature) ? null : tier;
}
