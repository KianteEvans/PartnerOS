"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { auditLog, caseStudies, evidence } from "@/db/schema";
import { evidenceEvalRateLimiter } from "@/redis/ratelimit";
import { generateCaseStudy, isCaseStudyGenEnabled } from "@/domain/case-studies/generate-client";

/**
 * Optional, key-gated AI drafting of a case study's narrative aspects from its
 * linked evidence. Read-only w.r.t. the gate (a direct RLS update + best-effort
 * audit, like the application response drafter); requires a session, is gated +
 * rate-limited, and only ever reads the artifact server-side.
 */

export interface DraftCaseStudyState {
  ok: boolean;
  error?: string;
}

export async function draftCaseStudyAction(
  _prev: DraftCaseStudyState,
  formData: FormData,
): Promise<DraftCaseStudyState> {
  const identity = await tryGetServerIdentity();
  if (!identity) return { ok: false, error: "Sign in to draft a case study." };
  const caseStudyId = String(formData.get("caseStudyId") ?? "");
  if (!caseStudyId) return { ok: false, error: "Missing case study." };
  if (!isCaseStudyGenEnabled()) {
    return { ok: false, error: "AI drafting isn't configured. Set ANTHROPIC_API_KEY to enable it." };
  }

  const rl = await evidenceEvalRateLimiter.limit(`${identity.tenantId}:${identity.userId}`);
  if (!rl.success) {
    const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return { ok: false, error: `Too many drafts - try again in ${retry}s.` };
  }

  // RLS-load the case study + its linked evidence (never trust client text).
  const loaded = await withTenant(identity, async (tx) => {
    const [cs] = await tx
      .select({
        title: caseStudies.title,
        customerName: caseStudies.customerName,
        evidenceId: caseStudies.evidenceId,
      })
      .from(caseStudies)
      .where(and(eq(caseStudies.id, caseStudyId), eq(caseStudies.tenantId, identity.tenantId)));
    if (!cs) return null;
    let evidenceTitle = "";
    let evidenceNotes = "";
    if (cs.evidenceId) {
      const [ev] = await tx
        .select({ title: evidence.title, notes: evidence.reviewNotes })
        .from(evidence)
        .where(and(eq(evidence.id, cs.evidenceId), eq(evidence.tenantId, identity.tenantId)));
      if (ev) {
        evidenceTitle = ev.title;
        evidenceNotes = ev.notes;
      }
    }
    return { title: cs.title, customerName: cs.customerName, evidenceTitle, evidenceNotes };
  });
  if (!loaded) return { ok: false, error: "Case study not found." };

  let draft;
  try {
    draft = await generateCaseStudy(loaded);
  } catch {
    return { ok: false, error: "Couldn't draft the case study just now. Please try again." };
  }

  // Persist the drafted aspects + audit (counts only). Best-effort.
  await withTenant(identity, async (tx) => {
    await tx
      .update(caseStudies)
      .set({
        aboutCustomer: draft.aboutCustomer,
        challenge: draft.challenge,
        goals: draft.goals,
        solution: draft.solution,
        outcomes: draft.outcomes,
        updatedAt: sql`now()`,
      })
      .where(and(eq(caseStudies.id, caseStudyId), eq(caseStudies.tenantId, identity.tenantId)));
    await tx.insert(auditLog).values({
      tenantId: identity.tenantId,
      actorUserId: identity.userId,
      action: "case_study.ai_draft",
      resourceType: "case_study",
      resourceId: caseStudyId,
      metadata: { hasEvidence: loaded.evidenceTitle !== "" },
    });
  }).catch(() => undefined);

  revalidatePath(`/programs/evidence/case-studies/${caseStudyId}`);
  return { ok: true };
}
