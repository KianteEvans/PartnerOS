import { getServerIdentity } from "@/auth/session";
import { requirePermission } from "@/authz/permissions";
import { loadCommandData } from "@/domain/command/load";
import { buildCommandCenter } from "@/domain/command/aggregate";
import { AppError } from "@/http/errors";

/**
 * Executive packet export (CSV): health, work summary, progress, and the top
 * decisions. Read-only and tenant-scoped via RLS (loadCommandData runs under
 * withTenant).
 */
export async function GET(): Promise<Response> {
  try {
    const identity = await getServerIdentity();
    requirePermission(identity, "command:read");
    const today = new Date().toISOString().slice(0, 10);

    const data = await loadCommandData(identity);
    const cc = buildCommandCenter(data.inputs, today);
    const emailById = new Map(data.members.map((m) => [m.id, m.email]));
    const owner = (id: string | null) => (id ? emailById.get(id) ?? "" : "");

    const lines: string[] = ["section,key,value"];
    lines.push(["health", "score", cc.health.score].map(cell).join(","));
    lines.push(["health", "band", cc.health.band].map(cell).join(","));
    for (const d of cc.health.drivers) lines.push(["health", d.label.toLowerCase(), d.score].map(cell).join(","));
    lines.push(["work", "open", cc.work.open].map(cell).join(","));
    lines.push(["work", "overdue", cc.work.overdue].map(cell).join(","));
    lines.push(["work", "blocked", cc.work.blocked].map(cell).join(","));
    lines.push(["work", "critical", cc.work.critical].map(cell).join(","));
    lines.push(["progress", "programs_active", `${cc.progress.programsActive}/${cc.progress.programsTotal}`].map(cell).join(","));
    lines.push(["progress", "tasks_done", `${cc.progress.tasksDone}/${cc.progress.tasksTotal}`].map(cell).join(","));
    lines.push(["progress", "tier_percent", cc.progress.tierPercent ?? ""].map(cell).join(","));

    lines.push("");
    lines.push(["decision_severity", "decision_title", "owner", "due"].map(cell).join(","));
    for (const d of cc.decisions) {
      lines.push([d.severity, d.title, owner(d.ownerUserId), d.dueDate ?? ""].map(cell).join(","));
    }

    return new Response(lines.join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="command-packet.csv"',
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return new Response(err instanceof AppError ? err.message : "Error", { status });
  }
}

function cell(value: unknown): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
