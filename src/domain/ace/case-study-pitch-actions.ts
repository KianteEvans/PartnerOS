"use server";

import { z } from "zod";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { auditLog } from "@/db/schema";
import { can } from "@/authz/permissions";
import { caseStudyPitchRateLimiter } from "@/redis/ratelimit";
import { loadPitchContext } from "@/domain/ace/case-study-match-load";
import { isCaseStudyPitchEnabled, generateCaseStudyPitch } from "@/domain/ace/case-study-pitch-ai";

/**
 * Server action for the AI case-study pitch. Same recipe as the other AI helpers:
 * identity -> feature gate -> per-user rate limit -> re-derive the matches UNDER RLS
 * (the form carries ONLY the opportunity id — never client text) -> call the model on
 * server data -> map returned titles back to case-study ids, dropping anything the
 * model invented -> audit counts only.
 */

export interface CaseStudyPitchItem {
  readonly caseStudyId: string;
  readonly title: string;
  readonly why: string;
}

export interface CaseStudyPitchState {
  readonly ok: boolean;
  readonly pitches?: readonly CaseStudyPitchItem[];
  readonly error?: string;
}

const inputSchema = z.object({ opportunityId: z.string().uuid() });

export async function generateCaseStudyPitchAction(
  _prev: CaseStudyPitchState,
  formData: FormData,
): Promise<CaseStudyPitchState> {
  const identity = await tryGetServerIdentity();
  if (!identity) return { ok: false, error: "Sign in to generate the pitch." };
  if (!can(identity.role, "ace:read")) return { ok: false, error: "You don't have access to ACE." };
  if (!isCaseStudyPitchEnabled()) {
    return { ok: false, error: "AI pitch isn't configured. Set ANTHROPIC_API_KEY to enable it." };
  }

  const parsed = inputSchema.safeParse({ opportunityId: formData.get("opportunityId") });
  if (!parsed.success) return { ok: false, error: "Invalid opportunity." };

  const rl = await caseStudyPitchRateLimiter.limit(`${identity.tenantId}:${identity.userId}`);
  if (!rl.success) {
    const retry = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return { ok: false, error: `Too many pitches — try again in ${retry}s.` };
  }

  const context = await loadPitchContext(identity, parsed.data.opportunityId);
  if (!context) return { ok: false, error: "Opportunity not found." };
  if (context.matches.length === 0) {
    return { ok: false, error: "No relevant case studies to pitch yet." };
  }

  try {
    const lines = await generateCaseStudyPitch({
      opp: { ...context.oppInput, stage: context.stage, amount: context.amount },
      matches: context.matches,
    });
    if (!lines) return { ok: false, error: "Couldn't parse the pitch. Please try again." };

    // Titles -> ids against the server-derived matches; hallucinated titles drop out.
    const idByTitle = new Map(context.matches.map((m) => [m.title.trim().toLowerCase(), m.id]));
    const pitches: CaseStudyPitchItem[] = [];
    for (const line of lines) {
      const id = idByTitle.get(line.title.trim().toLowerCase());
      if (id && !pitches.some((p) => p.caseStudyId === id)) {
        pitches.push({ caseStudyId: id, title: line.title, why: line.why });
      }
    }
    if (pitches.length === 0) return { ok: false, error: "Couldn't parse the pitch. Please try again." };

    // Audit — counts only, never the text.
    await withTenant(identity, (tx) =>
      tx.insert(auditLog).values({
        tenantId: identity.tenantId,
        actorUserId: identity.userId,
        action: "ace.case_study_pitch",
        resourceType: "opportunity",
        resourceId: parsed.data.opportunityId,
        metadata: { matches: context.matches.length, pitches: pitches.length },
      }),
    ).catch(() => undefined);

    return { ok: true, pitches };
  } catch {
    return { ok: false, error: "Couldn't generate the pitch just now. Please try again." };
  }
}
