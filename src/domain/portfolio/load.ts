import { eq, asc } from "drizzle-orm";
import { withSystem } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { tenants } from "@/db/schema";
import { can, type Role } from "@/authz/permissions";
import { loadCommandData } from "@/domain/command/load";
import { buildCommandCenter, type CommandCenter } from "@/domain/command/aggregate";
import { loadTenantMeta, type TenantMeta } from "@/auth/agency";
import {
  portfolioRollup,
  EMPTY_ROLLUP,
  type WorkspaceSummary,
  type PortfolioRollup,
} from "./rollup";

/**
 * Read side of agency portfolio mode (Bet C). An agency operator reads a cross-
 * workspace overview by iterating the managed tenants and reusing the existing
 * Command Center aggregation per tenant — the same per-tenant iteration the
 * playbook + benchmark crons use, so no RLS policy is widened.
 *
 * IMPORTANT: the per-child read uses a synthesized identity with role "viewer".
 * `loadCommandData` materializes playbooks on read, but that runner early-returns
 * for a role lacking playbook:run — so a viewer identity reads everything with ZERO
 * write side effects. (RLS itself keys only off tenant_id, so the role is inert for
 * reads.) The security boundary is `agency_id` verification before every read.
 */

const MAX_WORKSPACES = 50;

export interface PortfolioView {
  readonly isAgency: boolean;
  readonly agencyName: string | null;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly rollup: PortfolioRollup;
  /** True when more than MAX_WORKSPACES managed workspaces exist (grid is truncated). */
  readonly capped: boolean;
  readonly total: number;
}

function synthIdentity(childId: string, operatorId: string): DbIdentity {
  return { tenantId: childId, userId: operatorId, role: "viewer" };
}

function summarize(
  meta: { id: string; name: string; slug: string; tier: string },
  cc: CommandCenter,
  pipeline: number,
): WorkspaceSummary {
  return {
    id: meta.id,
    name: meta.name,
    slug: meta.slug,
    tier: meta.tier,
    health: cc.health.score,
    band: cc.health.band,
    openWork: cc.work.open,
    overdue: cc.work.overdue,
    renewalsDue: cc.decisions.filter((d) => d.situation === "renewal_due").length,
    attention: cc.decisions.length,
    pipeline,
    topRisk: cc.topRisk ? { title: cc.topRisk.title, severity: cc.topRisk.severity } : null,
  };
}

function openPipeline(cc: Awaited<ReturnType<typeof loadCommandData>>): number {
  return cc.inputs.opportunities
    .filter((o) => o.status === "open")
    .reduce((a, o) => a + (o.amount ?? 0), 0);
}

/** The agency portfolio overview. Non-agency / unauthorized -> an empty view. */
export async function loadPortfolio(identity: DbIdentity): Promise<PortfolioView> {
  const agency = await loadTenantMeta(identity.tenantId);
  if (!agency?.isAgency || !can(identity.role as Role, "portfolio:read")) {
    return { isAgency: false, agencyName: null, workspaces: [], rollup: EMPTY_ROLLUP, capped: false, total: 0 };
  }

  const children = await withSystem((tx) =>
    tx
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, tier: tenants.tier })
      .from(tenants)
      .where(eq(tenants.agencyId, identity.tenantId))
      .orderBy(asc(tenants.name)),
  );
  const capped = children.length > MAX_WORKSPACES;
  const slice = capped ? children.slice(0, MAX_WORKSPACES) : children;
  const today = new Date().toISOString().slice(0, 10);

  const summaries: WorkspaceSummary[] = [];
  for (const c of slice) {
    const data = await loadCommandData(synthIdentity(c.id, identity.userId));
    const cc = buildCommandCenter(data.inputs, today);
    summaries.push(summarize(c, cc, openPipeline(data)));
  }

  return {
    isAgency: true,
    agencyName: agency.name,
    workspaces: summaries,
    rollup: portfolioRollup(summaries),
    capped,
    total: children.length,
  };
}

export interface ManagedWorkspaceView {
  readonly meta: TenantMeta;
  readonly cc: CommandCenter;
  readonly ownerName: (id: string | null) => string;
}

/**
 * Read-only drill-in for one managed workspace. Re-verifies the agency->workspace
 * link (the security boundary) before reading; returns null when unauthorized or
 * the workspace is not managed by this agency.
 */
export async function loadManagedWorkspace(
  identity: DbIdentity,
  childId: string,
): Promise<ManagedWorkspaceView | null> {
  const agency = await loadTenantMeta(identity.tenantId);
  if (!agency?.isAgency || !can(identity.role as Role, "portfolio:read")) return null;
  const child = await loadTenantMeta(childId);
  if (!child || child.agencyId !== identity.tenantId) return null; // authz boundary

  const data = await loadCommandData(synthIdentity(childId, identity.userId));
  const today = new Date().toISOString().slice(0, 10);
  const cc = buildCommandCenter(data.inputs, today);
  const emailById = new Map(data.members.map((m) => [m.id, m.email]));
  return {
    meta: child,
    cc,
    ownerName: (id) => (id ? (emailById.get(id) ?? "-") : "Unassigned"),
  };
}
