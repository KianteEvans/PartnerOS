"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { reports } from "@/db/schema";
import { can } from "@/authz/permissions";
import { reportNarrativeRateLimiter } from "@/redis/ratelimit";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import { reportIdSchema } from "@/domain/reports/schemas";
import { loadCommandData } from "@/domain/command/load";
import { loadAttributionExtra } from "@/domain/graph/graph-load";
import { buildAttributionGraph } from "@/domain/graph/attribution";
import { narrativeOutline } from "@/domain/reports/narrative";
import { saveNarrativeOp } from "@/domain/reports/operations";
import { isReportNarrativeAiEnabled, generateNarrativeProse } from "@/domain/reports/narrative-ai";
import type { ReportSnapshot } from "@/domain/reports/metrics";

/**
 * Generate + save the executive narrative for a DRAFT report. Grounding is composed
 * server-side under RLS: the report's FROZEN snapshot tells the story's numbers, the
 * live attribution graph contributes the value-flow topology. The deterministic
 * outline is always computed; when ANTHROPIC_API_KEY is present an AI pass rewrites
 * it into prose (falling back to the outline on any failure), so the feature works
 * in every environment. The save goes through the mutation gate (report:update);
 * the audit records counts only — never the narrative text.
 */
export async function generateReportNarrative(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const identity = await tryGetServerIdentity();
  if (!identity) return { ok: false, error: "Sign in to generate the narrative." };
  if (!can(identity.role, "report:update")) {
    return { ok: false, error: "You don't have permission to edit reports." };
  }

  let reportId = "";
  try {
    ({ reportId } = parseOrThrow(reportIdSchema, { reportId: formData.get("reportId") }));
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.expose ? err.message : "Something went wrong" };
    throw err;
  }

  // Covers the fallback path too — even without AI this walks the whole workspace.
  const rl = await reportNarrativeRateLimiter.limit(`${identity.tenantId}:${identity.userId}`);
  if (!rl.success) {
    const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return { ok: false, error: `Too many narratives — try again in ${retry}s.` };
  }

  const report = await withTenant(identity, async (tx) => {
    const [row] = await tx
      .select({ status: reports.status, snapshot: reports.snapshot })
      .from(reports)
      .where(and(eq(reports.id, reportId), eq(reports.tenantId, identity.tenantId)));
    return row ?? null;
  });
  if (!report) return { ok: false, error: "Report not found." };
  if (report.status !== "draft") return { ok: false, error: "Only a draft report's narrative can be rewritten." };
  const snapshot = report.snapshot as ReportSnapshot;

  // Frozen snapshot + live value-flow topology -> deterministic outline.
  const today = new Date().toISOString().slice(0, 10);
  const { inputs } = await loadCommandData(identity);
  const extra = await loadAttributionExtra(identity);
  const graph = buildAttributionGraph(inputs, extra, today);
  const outline = narrativeOutline(snapshot, graph, today);

  let narrative = outline;
  let aiUsed = false;
  if (isReportNarrativeAiEnabled()) {
    try {
      const prose = await generateNarrativeProse({ outline, snapshot });
      if (prose.length > 0) {
        narrative = prose;
        aiUsed = true;
      }
    } catch {
      // AI unavailable -> the outline is the honest fallback.
    }
  }

  try {
    await runMutation({
      permission: "report:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ reportId, chars: narrative.length }),
      action: "report.narrative",
      resourceType: "report",
      resourceId: () => reportId,
      auditMetadata: { chars: narrative.length, aiUsed },
      handler: (ctx) => saveNarrativeOp(ctx, { id: reportId, narrative }),
    });
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.expose ? err.message : "Something went wrong" };
    throw err;
  }
  revalidatePath(`/reports/${reportId}`);
  return {
    ok: true,
    detail: aiUsed
      ? "AI executive narrative saved."
      : "Deterministic narrative outline saved — set ANTHROPIC_API_KEY for AI prose.",
  };
}
