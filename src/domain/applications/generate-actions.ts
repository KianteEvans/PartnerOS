"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { tryGetServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { auditLog, applicationControls, competencyApplications, evidence } from "@/db/schema";
import { competencyGenRateLimiter } from "@/redis/ratelimit";
import {
  generateControlResponse,
  isCompetencyGenEnabled,
} from "@/domain/applications/generate-client";
import { selectEvidenceForControl, type GroundingEvidence } from "@/domain/applications/grounding";
import type { Met } from "@/domain/applications/generate-parse";
import type { ProgramType } from "@/domain/applications/detect";

/**
 * AI control-response drafting. Read-only w.r.t. domain data except a single
 * RLS-scoped write-back of the draft (the durable artifact the partner exports) +
 * an audit row — like the evidence evaluator, so it does NOT go through the
 * mutation gate. Key-gated, rate-limited, and grounds ONLY on RLS-loaded evidence
 * (never client-supplied text).
 */

export interface GenerateControlState {
  ok: boolean;
  response?: string;
  met?: Met;
  confidence?: number;
  reasoning?: string;
  evidenceUsed?: string[];
  error?: string;
}

export async function generateControlResponseAction(
  _prev: GenerateControlState,
  formData: FormData,
): Promise<GenerateControlState> {
  const identity = await tryGetServerIdentity();
  if (!identity) return { ok: false, error: "Sign in to generate responses." };

  const controlId = String(formData.get("controlId") ?? "");
  if (!controlId) return { ok: false, error: "Missing control." };
  if (!isCompetencyGenEnabled()) {
    return { ok: false, error: "AI drafting isn't configured. Set ANTHROPIC_API_KEY to enable it." };
  }
  if (!can(identity.role, "application:update")) {
    return { ok: false, error: "You don't have permission to do this." };
  }

  const rl = await competencyGenRateLimiter.limit(`${identity.tenantId}:${identity.userId}`);
  if (!rl.success) {
    const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return { ok: false, error: `Too many requests — try again in ${retry}s.` };
  }

  // RLS-load the control, its competency, and the tenant's usable evidence.
  const loaded = await withTenant(identity, async (tx) => {
    const [ctrl] = await tx
      .select({
        controlId: applicationControls.controlId,
        applicationId: applicationControls.applicationId,
        requirement: applicationControls.requirementText,
        section: applicationControls.section,
        exampleResponse: applicationControls.exampleResponse,
      })
      .from(applicationControls)
      .where(
        and(
          eq(applicationControls.id, controlId),
          eq(applicationControls.tenantId, identity.tenantId),
        ),
      );
    if (!ctrl) return null;
    const [app] = await tx
      .select({
        competency: competencyApplications.competency,
        programType: competencyApplications.programType,
      })
      .from(competencyApplications)
      .where(
        and(
          eq(competencyApplications.id, ctrl.applicationId),
          eq(competencyApplications.tenantId, identity.tenantId),
        ),
      );
    const ev = await tx
      .select({
        id: evidence.id,
        title: evidence.title,
        notes: evidence.reviewNotes,
        evidenceType: evidence.evidenceType,
        status: evidence.status,
        qualityScore: evidence.qualityScore,
      })
      .from(evidence)
      .where(
        and(
          eq(evidence.tenantId, identity.tenantId),
          inArray(evidence.status, ["approved", "collected", "in_review"]),
        ),
      );
    return { ctrl, competency: app?.competency ?? "", programType: app?.programType ?? "", evidence: ev };
  });
  if (!loaded) return { ok: false, error: "Control not found." };

  const grounding: GroundingEvidence[] = loaded.evidence.map((e) => ({
    id: e.id,
    title: e.title,
    notes: e.notes,
    evidenceType: e.evidenceType,
    status: e.status,
    qualityScore: e.qualityScore,
  }));
  const selected = selectEvidenceForControl(loaded.ctrl.requirement, loaded.ctrl.section, grounding);

  let draft;
  try {
    draft = await generateControlResponse({
      programType: (loaded.programType || "Unknown") as ProgramType,
      competencyName: loaded.competency,
      sectionName: loaded.ctrl.section,
      controlId: loaded.ctrl.controlId,
      requirement: loaded.ctrl.requirement,
      ...(loaded.ctrl.exampleResponse ? { exampleResponse: loaded.ctrl.exampleResponse } : {}),
      evidence: selected.map((e) => ({
        title: e.title,
        notes: e.notes,
        type: e.evidenceType,
        status: e.status,
      })),
    });
  } catch {
    return { ok: false, error: "Couldn't draft a response just now. Please try again." };
  }

  // Map cited titles back to evidence ids (the model never sees ids).
  const wanted = new Set(draft.citedEvidenceTitles.map((t) => t.trim().toLowerCase()));
  const citedIds = selected.filter((e) => wanted.has(e.title.trim().toLowerCase())).map((e) => e.id);

  // Persist the draft (it's what gets exported) + audit counts only. Best-effort.
  await withTenant(identity, async (tx) => {
    await tx
      .update(applicationControls)
      .set({
        recommendedResponse: draft.response,
        metSuggestion: draft.met,
        aiConfidence: draft.confidence,
        aiReasoning: draft.reasoning,
        linkedEvidenceIds: citedIds,
        status: "generated",
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(applicationControls.id, controlId),
          eq(applicationControls.tenantId, identity.tenantId),
        ),
      );
    await tx.insert(auditLog).values({
      tenantId: identity.tenantId,
      actorUserId: identity.userId,
      action: "application.ai_generate",
      resourceType: "application_control",
      resourceId: controlId,
      metadata: { confidence: draft.confidence, evidenceCount: selected.length, met: draft.met },
    });
  }).catch(() => undefined);

  return {
    ok: true,
    response: draft.response,
    met: draft.met,
    confidence: draft.confidence,
    reasoning: draft.reasoning,
    evidenceUsed: draft.citedEvidenceTitles,
  };
}
