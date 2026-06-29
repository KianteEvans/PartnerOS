import { ilike } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import {
  tasks,
  mdfRequests,
  opportunities,
  aceRelationships,
  evidence,
  programs,
  assessments,
  roadmaps,
  reports,
} from "@/db/schema";
import { AppError } from "@/http/errors";

/**
 * Cross-table quick search for the command palette. Tenant-scoped via RLS
 * (withTenant), gated on a valid session. Each source is a case-insensitive
 * substring match on the entity's name/title, capped per source; results are
 * round-robin interleaved so no single type buries the rest. Records with a
 * detail page deep-link to it; the rest link to their (now searchable) list.
 *
 * Note: ilike with a leading wildcard can't use a btree index — fine at this
 * app's scale; a trigram/GIN index would be the move for large tenants.
 */
export interface SearchResult {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly href: string;
}

const PER_SOURCE = 5;
const MAX_RESULTS = 24;

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const identity = await getServerIdentity();
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return Response.json({ results: [] });
    const like = `%${q}%`;
    const enc = (s: string): string => encodeURIComponent(s);

    const lists = await withTenant(identity, async (tx) => {
      const taskRows = await tx.select({ id: tasks.id, label: tasks.title }).from(tasks).where(ilike(tasks.title, like)).limit(PER_SOURCE);
      const mdfRows = await tx.select({ id: mdfRequests.id, label: mdfRequests.title }).from(mdfRequests).where(ilike(mdfRequests.title, like)).limit(PER_SOURCE);
      const oppRows = await tx.select({ id: opportunities.id, label: opportunities.name }).from(opportunities).where(ilike(opportunities.name, like)).limit(PER_SOURCE);
      const relRows = await tx.select({ id: aceRelationships.id, label: aceRelationships.name }).from(aceRelationships).where(ilike(aceRelationships.name, like)).limit(PER_SOURCE);
      const evRows = await tx.select({ id: evidence.id, label: evidence.title }).from(evidence).where(ilike(evidence.title, like)).limit(PER_SOURCE);
      const progRows = await tx.select({ id: programs.id, label: programs.name }).from(programs).where(ilike(programs.name, like)).limit(PER_SOURCE);
      const assessRows = await tx.select({ id: assessments.id, label: assessments.name }).from(assessments).where(ilike(assessments.name, like)).limit(PER_SOURCE);
      const roadRows = await tx.select({ id: roadmaps.id, label: roadmaps.name }).from(roadmaps).where(ilike(roadmaps.name, like)).limit(PER_SOURCE);
      const repRows = await tx.select({ id: reports.id, label: reports.title }).from(reports).where(ilike(reports.title, like)).limit(PER_SOURCE);

      return [
        taskRows.map((r): SearchResult => ({ id: r.id, type: "Task", label: r.label, href: `/command/tasks?q=${enc(r.label)}` })),
        mdfRows.map((r): SearchResult => ({ id: r.id, type: "MDF request", label: r.label, href: `/mdf/${r.id}` })),
        oppRows.map((r): SearchResult => ({ id: r.id, type: "Opportunity", label: r.label, href: `/ace?tab=opportunities&q=${enc(r.label)}` })),
        relRows.map((r): SearchResult => ({ id: r.id, type: "Relationship", label: r.label, href: `/ace?tab=relationships&q=${enc(r.label)}` })),
        evRows.map((r): SearchResult => ({ id: r.id, type: "Evidence", label: r.label, href: `/programs/evidence?q=${enc(r.label)}` })),
        progRows.map((r): SearchResult => ({ id: r.id, type: "Program", label: r.label, href: `/programs/${r.id}` })),
        assessRows.map((r): SearchResult => ({ id: r.id, type: "Assessment", label: r.label, href: `/plan/${r.id}` })),
        roadRows.map((r): SearchResult => ({ id: r.id, type: "Roadmap", label: r.label, href: `/plan/roadmaps/${r.id}` })),
        repRows.map((r): SearchResult => ({ id: r.id, type: "Report", label: r.label, href: `/reports/${r.id}` })),
      ];
    });

    const merged: SearchResult[] = [];
    for (let i = 0; merged.length < MAX_RESULTS; i++) {
      const before = merged.length;
      for (const list of lists) {
        const item = list[i];
        if (item) {
          merged.push(item);
          if (merged.length >= MAX_RESULTS) break;
        }
      }
      if (merged.length === before) break;
    }

    return Response.json(
      { results: merged },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return new Response(err instanceof AppError ? err.message : "Error", { status });
  }
}
