import { and, asc, eq } from "drizzle-orm";
import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { roadmaps, roadmapMilestones, users } from "@/db/schema";
import { AppError } from "@/http/errors";

/**
 * Roadmap milestone export (CSV) for sharing a plan outside the app. Read-only
 * and tenant-scoped via RLS; gated by roadmap:read.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const identity = await getServerIdentity();
    requirePermission(identity, "roadmap:read");

    const data = await withTenant(identity, async (tx) => {
      const [roadmap] = await tx
        .select({ name: roadmaps.name })
        .from(roadmaps)
        .where(and(eq(roadmaps.id, id), eq(roadmaps.tenantId, identity.tenantId)));
      if (!roadmap) return null;
      const ms = await tx
        .select()
        .from(roadmapMilestones)
        .where(
          and(
            eq(roadmapMilestones.roadmapId, id),
            eq(roadmapMilestones.tenantId, identity.tenantId),
          ),
        )
        .orderBy(asc(roadmapMilestones.sequence));
      const members = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.tenantId, identity.tenantId));
      return { ms, members };
    });
    if (!data) return new Response("Not found", { status: 404 });

    const emailById = new Map(data.members.map((m) => [m.id, m.email]));
    const header = ["sequence", "title", "detail", "status", "target_date", "owner", "origin"];
    const lines = [header.join(",")];
    for (const m of data.ms) {
      lines.push(
        [
          m.sequence,
          m.title,
          m.detail,
          m.status,
          m.targetDate,
          m.ownerUserId ? emailById.get(m.ownerUserId) ?? "" : "",
          m.originKind === "custom" ? "" : m.originLabel,
        ]
          .map(csvCell)
          .join(","),
      );
    }

    return new Response(lines.join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="roadmap-${id}.csv"`,
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
