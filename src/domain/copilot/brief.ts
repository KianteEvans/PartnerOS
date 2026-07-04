import type { CommandCenter } from "@/domain/command/aggregate";
import type { TierPath } from "@/domain/tiers/path";

/**
 * Compile the live cross-domain workspace state into a compact, deterministic text
 * brief — the grounding the Alliance Copilot (a gated LLM) reasons over. Pure: no DB,
 * no clock, no secrets. Reuses the already-computed Command Center (health, decision
 * queue, next-best-actions, progress) + the Tier Path (ETA/scenarios). The copilot is
 * instructed to answer ONLY from this brief, so it can't invent programs/requirements.
 */
export function compileWorkspaceBrief(
  cc: CommandCenter,
  path: TierPath | null,
  currentTierLabel: string,
  targetTierLabel: string,
  today: string,
): string {
  const lines: string[] = [];
  lines.push(`PartnerOS workspace brief (as of ${today}).`);
  lines.push("");
  lines.push(
    `Partnership health: ${cc.health.score}/100 (${cc.health.band}). Drivers — ${cc.health.drivers
      .map((d) => `${d.label} ${d.score}`)
      .join(", ")}.`,
  );

  const p = cc.progress;
  const steady = path?.scenarios.find((s) => s.id === "steady") ?? path?.scenarios[0];
  const tierLine =
    p.tierPercent === null
      ? `Tier: ${currentTierLabel} (no active advancement plan).`
      : `Tier: ${currentTierLabel} → ${targetTierLabel}, ${p.tierPercent}% ready${
          path ? `, ${path.remaining} requirement${path.remaining === 1 ? "" : "s"} remaining` : ""
        }.`;
  lines.push(steady?.etaDate ? `${tierLine} Fastest realistic ETA (steady pace): ${steady.etaDate}.` : tierLine);
  lines.push(
    `Progress: ${p.programsActive}/${p.programsTotal} programs active, ${p.tasksDone}/${p.tasksTotal} tasks done.`,
  );
  lines.push("");

  const decisions = cc.decisions.slice(0, 5);
  if (decisions.length > 0) {
    lines.push("Top attention items (most urgent first):");
    for (const d of decisions) lines.push(`- [${d.severity}] ${d.title} — ${d.detail}`);
    lines.push("");
  }

  const moves = cc.nextBestActions.slice(0, 3);
  if (moves.length > 0) {
    lines.push("Highest-leverage next moves (projected impact if done):");
    for (const m of moves) {
      const bits: string[] = [];
      if (m.impact.healthDelta > 0) bits.push(`health +${m.impact.healthDelta}`);
      if (m.impact.tierPctDelta > 0) bits.push(`tier +${m.impact.tierPctDelta}%`);
      if (m.impact.queueDelta > 0) bits.push(`alerts -${m.impact.queueDelta}`);
      if (m.quickWin) bits.push("quick win");
      lines.push(`- ${m.title} — ${m.detail}${bits.length ? ` (${bits.join(", ")})` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}
