import { and, asc, eq } from "drizzle-orm";
import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { tierPlans, tierRequirements } from "@/db/schema";
import { gapFor } from "@/domain/tiers/gap";
import { TIER_LABELS, type TierId, type RequirementKind } from "@/domain/tiers/catalog";
import { AppError } from "@/http/errors";

/**
 * Advancement packet export (CSV): the target tier's thresholds, current values,
 * gaps, owners, and linkage. Read-only and tenant-scoped via RLS.
 */
export async function GET(): Promise<Response> {
  try {
    const identity = await getServerIdentity();
    requirePermission(identity, "tier:read");

    const { plan, reqs } = await withTenant(identity, async (tx) => {
      const [plan] = await tx
        .select()
        .from(tierPlans)
        .where(eq(tierPlans.tenantId, identity.tenantId));
      if (!plan) return { plan: null, reqs: [] };
      const reqs = await tx
        .select()
        .from(tierRequirements)
        .where(and(eq(tierRequirements.planId, plan.id), eq(tierRequirements.tenantId, identity.tenantId)))
        .orderBy(asc(tierRequirements.requirementKey));
      return { plan, reqs };
    });

    if (!plan) return new Response("No tier plan", { status: 404 });

    const header = [
      "target_tier", "requirement", "kind", "category", "threshold", "current_value",
      "secondary_label", "secondary_threshold", "secondary_current_value",
      "gap", "met", "informational", "note", "has_evidence", "has_task",
    ];
    const lines = [header.join(",")];
    for (const r of reqs) {
      const gap = gapFor({
        key: r.requirementKey,
        label: r.label,
        category: r.category,
        threshold: r.threshold,
        currentValue: r.currentValue,
        kind: r.kind as RequirementKind,
        secondaryThreshold: r.secondaryThreshold,
        secondaryCurrentValue: r.secondaryCurrentValue,
        informational: r.informational,
      });
      lines.push(
        [
          TIER_LABELS[plan.targetTier as TierId],
          r.label,
          r.kind,
          r.category,
          r.threshold,
          r.currentValue,
          r.secondaryLabel ?? "",
          r.secondaryThreshold ?? "",
          r.secondaryCurrentValue,
          gap.delta,
          gap.met ? "yes" : "no",
          r.informational ? "yes" : "no",
          r.note,
          r.evidenceId ? "yes" : "no",
          r.taskId ? "yes" : "no",
        ].map(csvCell).join(","),
      );
    }

    return new Response(lines.join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="tier-advancement-packet.csv"',
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return new Response(err instanceof AppError ? err.message : "Error", { status });
  }
}

function csvCell(value: unknown): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
