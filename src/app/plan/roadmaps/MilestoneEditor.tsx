"use client";

import {
  useEffect,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge, type Tone } from "@/components/ui/Badge";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { emitToast } from "@/components/ui/toast";
import { IDLE_STATE } from "@/domain/forms";
import {
  updateMilestone,
  setMilestoneStatus,
  reorderMilestones,
  addMilestone,
  removeMilestone,
} from "@/domain/roadmaps/actions";
import { isMilestoneOverdue } from "@/domain/roadmaps/progress";
import { analyzeSchedule } from "@/domain/roadmaps/schedule";

/**
 * The interactive milestone list — what makes a roadmap a *living* plan.
 * Reorder (drag the handle or use the arrows), set each milestone's status
 * (allowed even after finalize — status is progress, not structure), and
 * add/remove milestones while the roadmap is a draft. Order is held locally for
 * a snappy drag and re-seeded from the server after each persist; status is
 * optimistic. All mutations route through the gated server actions.
 */

type Status = "planned" | "in_progress" | "done" | "blocked";

export interface EditorMilestone {
  readonly id: string;
  readonly sequence: number;
  readonly title: string;
  readonly detail: string;
  readonly targetDate: string;
  readonly ownerUserId: string | null;
  readonly status: Status;
  readonly originKind: string;
  readonly originLabel: string;
  readonly taskId: string | null;
  readonly dependsOnId: string | null;
}
export interface EditorMember {
  readonly id: string;
  readonly email: string;
}

const STATUS_TONE: Record<Status, Tone> = {
  planned: "neutral",
  in_progress: "info",
  done: "ok",
  blocked: "danger",
};
const STATUS_LABEL: Record<Status, string> = {
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
};
const STATUSES = Object.keys(STATUS_LABEL) as Status[];

const labelStyle = { display: "grid", gap: 4, fontSize: 12 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const control: CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 8px",
  color: "var(--text)",
  fontSize: 13,
};
const cardStyle: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow)",
  padding: 14,
  // Clear the sticky top bar when a decision deep-links to this milestone (#ms-<id>).
  scrollMarginTop: 84,
};
function miniBtn(disabled: boolean): CSSProperties {
  return {
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: disabled ? "var(--muted)" : "var(--text)",
    cursor: disabled ? "default" : "pointer",
    fontSize: 13,
    padding: "2px 9px",
    opacity: disabled ? 0.5 : 1,
  };
}

export function MilestoneEditor({
  roadmapId,
  isDraft,
  milestones,
  members,
  progress,
}: {
  roadmapId: string;
  isDraft: boolean;
  milestones: readonly EditorMilestone[];
  members: readonly EditorMember[];
  progress?: Record<string, { label: string; tone: Tone; href: string }> | undefined;
}): ReactNode {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [order, setOrder] = useState<readonly EditorMilestone[]>(milestones);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Re-seed local order whenever the server data changes (after a refresh) --
  // include every mutable field a row renders so server-side edits (owner, the
  // task link on finalize, title/detail/date) refresh and don't read stale.
  const signature = milestones
    .map(
      (m) =>
        `${m.id}:${m.sequence}:${m.status}:${m.ownerUserId ?? ""}:${m.taskId ?? ""}:${m.title}:${m.detail}:${m.targetDate}:${m.dependsOnId ?? ""}`,
    )
    .join("|");
  useEffect(() => {
    setOrder(milestones);
  }, [signature]);

  const emailById = new Map(members.map((m) => [m.id, m.email]));

  function persistOrder(next: readonly EditorMilestone[]): void {
    setOrder(next);
    const fd = new FormData();
    fd.set("idempotencyKey", crypto.randomUUID());
    fd.set("roadmapId", roadmapId);
    fd.set("orderedIds", next.map((m) => m.id).join(","));
    startTransition(async () => {
      const res = await reorderMilestones(IDLE_STATE, fd);
      if (res.ok) router.refresh();
      else {
        setOrder(milestones);
        emitToast(res.error ?? "Could not reorder", "danger");
      }
    });
  }

  function move(index: number, dir: -1 | 1): void {
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    persistOrder(next);
  }

  function onDrop(index: number): void {
    setOverIndex(null);
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      return;
    }
    const next = [...order];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved!);
    setDragIndex(null);
    persistOrder(next);
  }

  function changeStatus(id: string, status: Status): void {
    setOrder((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m)));
    const fd = new FormData();
    fd.set("idempotencyKey", crypto.randomUUID());
    fd.set("roadmapId", roadmapId);
    fd.set("milestoneId", id);
    fd.set("status", status);
    startTransition(async () => {
      const res = await setMilestoneStatus(IDLE_STATE, fd);
      if (res.ok) router.refresh();
      else {
        setOrder(milestones);
        emitToast(res.error ?? "Could not update status", "danger");
      }
    });
  }

  function remove(id: string, title: string): void {
    if (!window.confirm(`Remove milestone "${title}"?`)) return;
    const fd = new FormData();
    fd.set("idempotencyKey", crypto.randomUUID());
    fd.set("roadmapId", roadmapId);
    fd.set("milestoneId", id);
    startTransition(async () => {
      const res = await removeMilestone(IDLE_STATE, fd);
      if (res.ok) {
        emitToast("Milestone removed.", "ok");
        router.refresh();
      } else emitToast(res.error ?? "Could not remove", "danger");
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Real dependency labels + schedule conflicts (pure, O(n)) over the live order.
  const seqById = new Map(order.map((m) => [m.id, m.sequence]));
  const analysis = analyzeSchedule(
    order.map((m) => ({ id: m.id, sequence: m.sequence, targetDate: m.targetDate, dependsOnId: m.dependsOnId })),
  );
  const conflictById = new Map(analysis.conflicts.map((c) => [c.id, c.predecessorSequence]));

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {order.map((m, i) => {
        const predSeq = m.dependsOnId ? seqById.get(m.dependsOnId) ?? null : null;
        const conflictPredSeq = conflictById.get(m.id);
        const isOver = overIndex === i && dragIndex !== null && dragIndex !== i;
        const pr = progress?.[m.id];
        const overdue = isMilestoneOverdue(m, today);
        return (
          <div
            key={m.id}
            id={`ms-${m.id}`}
            onDragOver={(e) => {
              if (!isDraft) return;
              e.preventDefault();
              setOverIndex(i);
            }}
            onDrop={() => isDraft && onDrop(i)}
            style={isOver ? { ...cardStyle, borderColor: "var(--accent)" } : cardStyle}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {isDraft && (
                  <span
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    title="Drag to reorder"
                    aria-hidden
                    style={{ cursor: "grab", color: "var(--muted)", fontSize: 15, userSelect: "none" }}
                  >
                    ⠿
                  </span>
                )}
                <strong style={{ fontSize: 14 }}>
                  {m.sequence}. {m.title}
                </strong>
                {m.originKind !== "custom" && m.originLabel && (
                  <Badge tone={m.originKind === "tier" ? "info" : "accent"}>
                    {m.originLabel}
                  </Badge>
                )}
                <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
                {overdue && <Badge tone="danger">Overdue</Badge>}
                {conflictPredSeq !== undefined && (
                  <Badge tone="danger">Scheduled before #{conflictPredSeq}</Badge>
                )}
              </div>
              <span
                style={{
                  color: overdue ? "var(--danger)" : "var(--muted)",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                Target {m.targetDate}
                {predSeq ? ` · after #${predSeq}` : " · no dependency"}
              </span>
            </div>

            {m.detail && (
              <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 10px" }}>
                {m.detail}
              </p>
            )}
            <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 10px" }}>
              Owner:{" "}
              {m.ownerUserId ? emailById.get(m.ownerUserId) ?? "—" : "Unassigned"}
              {m.taskId ? " · task created" : ""}
            </p>
            {pr && (
              <p
                style={{
                  fontSize: 12,
                  margin: "0 0 10px",
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  color: "var(--muted)",
                }}
              >
                Live progress:
                <Badge tone={pr.tone}>{pr.label}</Badge>
                <Link
                  href={pr.href}
                  style={{ color: "var(--accent)", textDecoration: "none" }}
                >
                  View →
                </Link>
              </p>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                Status
                <select
                  value={m.status}
                  onChange={(e) => changeStatus(m.id, e.target.value as Status)}
                  style={control}
                  aria-label={`Status for ${m.title}`}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>

              {isDraft && (
                <>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      style={miniBtn(i === 0)}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === order.length - 1}
                      style={miniBtn(i === order.length - 1)}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </div>

                  <FormDrawer
                    triggerLabel="Edit"
                    triggerVariant="secondary"
                    title={`Edit milestone ${m.sequence}`}
                    action={updateMilestone}
                    submitLabel="Save changes"
                    successMessage="Milestone updated."
                    submitVariant="secondary"
                    hidden={{ milestoneId: m.id, roadmapId }}
                  >
                    <label style={labelStyle}>
                      <span style={spanStyle}>Title</span>
                      <input name="title" defaultValue={m.title} maxLength={200} style={control} />
                    </label>
                    <label style={labelStyle}>
                      <span style={spanStyle}>Detail</span>
                      <input name="detail" defaultValue={m.detail} maxLength={500} style={control} />
                    </label>
                    <label style={labelStyle}>
                      <span style={spanStyle}>Owner</span>
                      <select name="ownerUserId" defaultValue={m.ownerUserId ?? ""} style={control}>
                        <option value="">Unassigned</option>
                        {members.map((mem) => (
                          <option key={mem.id} value={mem.id}>
                            {mem.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={labelStyle}>
                      <span style={spanStyle}>Target date</span>
                      <input name="targetDate" type="date" defaultValue={m.targetDate} style={control} />
                    </label>
                    <label style={labelStyle}>
                      <span style={spanStyle}>Depends on</span>
                      <select name="dependsOnId" defaultValue={m.dependsOnId ?? ""} style={control}>
                        <option value="">No dependency</option>
                        {order
                          .filter((o) => o.sequence < m.sequence)
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              #{o.sequence} {o.title}
                            </option>
                          ))}
                      </select>
                    </label>
                  </FormDrawer>

                  <button
                    type="button"
                    onClick={() => remove(m.id, m.title)}
                    style={{
                      background: "transparent",
                      border: "1px solid color-mix(in srgb, var(--danger) 45%, transparent)",
                      color: "var(--danger)",
                      borderRadius: 8,
                      padding: "6px 12px",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {isDraft && (
        <FormDrawer
          triggerLabel="+ Add milestone"
          triggerVariant="secondary"
          title="Add milestone"
          action={addMilestone}
          submitLabel="Add milestone"
          successMessage="Milestone added."
          hidden={{ roadmapId }}
        >
          <label style={labelStyle}>
            <span style={spanStyle}>Title</span>
            <input name="title" required maxLength={200} style={control} />
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>Detail</span>
            <input name="detail" maxLength={500} style={control} />
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>Target date</span>
            <input name="targetDate" type="date" required defaultValue={today} style={control} />
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>Owner</span>
            <select name="ownerUserId" defaultValue="" style={control}>
              <option value="">Unassigned</option>
              {members.map((mem) => (
                <option key={mem.id} value={mem.id}>
                  {mem.email}
                </option>
              ))}
            </select>
          </label>
        </FormDrawer>
      )}
    </div>
  );
}
