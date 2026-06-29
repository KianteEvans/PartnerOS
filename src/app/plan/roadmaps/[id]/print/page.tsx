import type { CSSProperties, ReactNode } from "react";
import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { roadmaps, roadmapMilestones, users } from "@/db/schema";
import {
  HORIZON_LABELS,
  SCENARIO_LABELS,
  type HorizonId,
  type ScenarioId,
} from "@/domain/roadmaps/planner";
import { roadmapProgress } from "@/domain/roadmaps/progress";
import { PrintButton } from "@/app/plan/roadmaps/PrintButton";

/**
 * Clean, read-only print/PDF view of a roadmap. Print-isolation CSS hides the
 * app chrome so only the plan prints; the button (Save as PDF) is screen-only.
 */
const PRINT_CSS = `@media print { body * { visibility: hidden; } #roadmap-print, #roadmap-print * { visibility: visible; } #roadmap-print { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`;

const cell: CSSProperties = {
  borderBottom: "1px solid var(--border)",
  padding: "6px 8px",
  verticalAlign: "top",
};

export default async function RoadmapPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");
  const today = new Date().toISOString().slice(0, 10);

  const data = await withTenant(identity, async (tx) => {
    const [roadmap] = await tx
      .select()
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
    return { roadmap, ms, members };
  });
  if (!data) notFound();
  const { roadmap, ms, members } = data;
  const emailById = new Map(members.map((m) => [m.id, m.email]));
  const prog = roadmapProgress(ms, today);

  return (
    <div style={{ padding: 24, maxWidth: 820 }}>
      <style>{PRINT_CSS}</style>
      <div className="no-print" style={{ marginBottom: 16 }}>
        <PrintButton />
      </div>
      <div id="roadmap-print">
        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>{roadmap.name}</h1>
        <p style={{ color: "var(--muted)", margin: "0 0 6px", fontSize: 13 }}>
          {HORIZON_LABELS[roadmap.horizon as HorizonId]} ·{" "}
          {SCENARIO_LABELS[roadmap.scenario as ScenarioId]} · Start{" "}
          {roadmap.startDate} · {roadmap.status} · {prog.done}/{prog.total} done (
          {prog.percentDone}%)
        </p>
        {roadmap.objective && (
          <p style={{ fontSize: 14, margin: "0 0 16px" }}>{roadmap.objective}</p>
        )}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["#", "Milestone", "Status", "Target", "Owner"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    borderBottom: "1px solid var(--border)",
                    padding: "6px 8px",
                    color: "var(--muted)",
                    fontWeight: 600,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ms.map((m) => (
              <tr key={m.id}>
                <td style={cell}>{m.sequence}</td>
                <td style={cell}>
                  <strong>{m.title}</strong>
                  {m.originKind !== "custom" && m.originLabel
                    ? ` · ${m.originLabel}`
                    : ""}
                  {m.detail && (
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      {m.detail}
                    </div>
                  )}
                </td>
                <td style={cell}>{m.status}</td>
                <td style={cell}>{m.targetDate}</td>
                <td style={cell}>
                  {m.ownerUserId ? emailById.get(m.ownerUserId) ?? "—" : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
