"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { Tone } from "@/components/ui/Badge";
import {
  MilestoneEditor,
  type EditorMilestone,
  type EditorMember,
} from "@/app/plan/roadmaps/MilestoneEditor";
import { RoadmapTimeline } from "@/app/plan/roadmaps/RoadmapTimeline";

/**
 * Switches the milestone panel between the editable list (reorder / status /
 * add-remove) and the read-only timeline. The toggle is the only client state;
 * both views render from the same milestone data.
 */
function seg(active: boolean): CSSProperties {
  return {
    padding: "5px 14px",
    borderRadius: 7,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    background: active ? "var(--panel)" : "transparent",
    color: active ? "var(--text)" : "var(--muted)",
    boxShadow: active ? "var(--shadow)" : "none",
  };
}

export function MilestoneViews({
  roadmapId,
  isDraft,
  milestones,
  members,
  progress,
  startDate,
  today,
}: {
  roadmapId: string;
  isDraft: boolean;
  milestones: readonly EditorMilestone[];
  members: readonly EditorMember[];
  progress?: Record<string, { label: string; tone: Tone; href: string }> | undefined;
  startDate: string;
  today: string;
}): ReactNode {
  const [view, setView] = useState<"list" | "timeline">("list");

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        role="tablist"
        aria-label="Milestone view"
        style={{
          display: "inline-flex",
          gap: 2,
          padding: 3,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 9,
          justifySelf: "start",
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === "list"}
          onClick={() => setView("list")}
          style={seg(view === "list")}
        >
          List
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "timeline"}
          onClick={() => setView("timeline")}
          style={seg(view === "timeline")}
        >
          Timeline
        </button>
      </div>

      {view === "list" ? (
        <MilestoneEditor
          roadmapId={roadmapId}
          isDraft={isDraft}
          milestones={milestones}
          members={members}
          progress={progress}
        />
      ) : (
        <RoadmapTimeline milestones={milestones} startDate={startDate} today={today} />
      )}
    </div>
  );
}
