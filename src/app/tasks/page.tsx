import type { ReactNode } from "react";
import Link from "next/link";
import { and, asc, count, desc, eq, gte, ilike, isNotNull, lt, lte, ne, type SQL } from "drizzle-orm";
import { redirect } from "next/navigation";
import { tryGetServerIdentity } from "@/auth/session";
import { withTenant } from "@/db/client";
import { tasks, users } from "@/db/schema";
import { PageShell } from "@/components/ui/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { MutationForm } from "@/components/ui/MutationForm";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { SearchForm } from "@/components/ui/SearchForm";
import { SavedViewsBar } from "@/components/ui/SavedViewsBar";
import { BulkProvider } from "@/components/ui/bulk/BulkProvider";
import { BulkBar } from "@/components/ui/bulk/BulkBar";
import { BulkCheckbox } from "@/components/ui/bulk/BulkCheckbox";
import { BulkActionForm } from "@/components/ui/bulk/BulkActionForm";
import { Pagination } from "@/components/ui/Pagination";
import { createTask, updateTask, completeTask, bulkUpdateTasks } from "@/domain/tasks/actions";
import { parseListParams, listHref, pageCount } from "@/domain/list";
import { addDays } from "@/domain/dates";
import {
  TASK_VIEWS,
  TASK_VIEW_LABELS,
  type TaskView,
} from "@/domain/tasks/views";

/**
 * SQL mirror of the pure `matchesView` (domain/tasks/views.ts) so the list is
 * filtered/counted in the database rather than by loading every row. Kept in
 * lockstep with that function.
 */
function taskViewCondition(view: TaskView, userId: string, today: string): SQL {
  const notDone = ne(tasks.status, "done");
  switch (view) {
    case "all":
      return notDone;
    case "mine":
      return and(notDone, eq(tasks.ownerUserId, userId)) as SQL;
    case "overdue":
      return and(notDone, isNotNull(tasks.dueDate), lt(tasks.dueDate, today)) as SQL;
    case "due_this_week":
      return and(
        notDone,
        isNotNull(tasks.dueDate),
        gte(tasks.dueDate, today),
        lte(tasks.dueDate, addDays(today, 7)),
      ) as SQL;
    case "completed":
      return eq(tasks.status, "done");
  }
}

const labelStyle = { display: "grid", gap: 4, fontSize: 13 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 8px",
  color: "var(--text)",
  fontSize: 13,
} as const;

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  assessment: "Assessment",
  mdf: "MDF",
  program: "Program",
  evidence: "Evidence",
  tier: "Tier",
  roadmap: "Roadmap",
  ace: "ACE",
};

function isView(v: string | undefined): v is TaskView {
  return v !== undefined && (TASK_VIEWS as readonly string[]).includes(v);
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  if (!identity) redirect("/");

  const sp = await searchParams;
  const viewParam = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view: TaskView = isView(viewParam) ? viewParam : "all";
  const params = parseListParams(sp, { sortable: [], defaultSort: "created" });
  const today = new Date().toISOString().slice(0, 10);
  const uid = identity.userId;

  const { pageTasks, total, counts, members } = await withTenant(identity, async (tx) => {
    const tenant = eq(tasks.tenantId, identity.tenantId);

    // Pills: one bounded count per view (independent of the text search).
    const countRows = await Promise.all(
      TASK_VIEWS.map((v) =>
        tx.select({ n: count() }).from(tasks).where(and(tenant, taskViewCondition(v, uid, today))),
      ),
    );
    const counts = Object.fromEntries(
      TASK_VIEWS.map((v, i) => [v, countRows[i]![0]?.n ?? 0]),
    ) as Record<TaskView, number>;

    // Display: active view + optional title search, sorted (priority desc, due
    // soonest, oldest), paginated.
    const where = and(
      tenant,
      taskViewCondition(view, uid, today),
      params.q ? ilike(tasks.title, `%${params.q}%`) : undefined,
    );
    const pageTasks = await tx
      .select()
      .from(tasks)
      .where(where)
      .orderBy(desc(tasks.priority), asc(tasks.dueDate), asc(tasks.createdAt), asc(tasks.id))
      .limit(params.pageSize)
      .offset(params.offset);
    const totalRows = await tx.select({ n: count() }).from(tasks).where(where);

    const members = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.tenantId, identity.tenantId));
    return { pageTasks, total: totalRows[0]?.n ?? 0, counts, members };
  });

  const emailById = new Map(members.map((m) => [m.id, m.email]));
  const totalPages = pageCount(total, params.pageSize);

  return (
    <PageShell>
      <PageHeader
        title="Task Manager"
        actions={
          <FormDrawer
            triggerLabel="New task"
            title="New task"
            action={createTask}
            submitLabel="Add task"
            successMessage="Task created."
          >
            <label style={labelStyle}>
              <span style={spanStyle}>Title</span>
              <input name="title" required maxLength={200} style={controlStyle} />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Description</span>
              <input name="description" maxLength={2000} style={controlStyle} />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Priority</span>
              <select name="priority" defaultValue="medium" style={controlStyle}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Due date</span>
              <input name="dueDate" type="date" style={controlStyle} />
            </label>
          </FormDrawer>
        }
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TASK_VIEWS.map((v) => {
            const active = v === view;
            return (
              <Link
                key={v}
                href={listHref("/tasks", { view: v, q: params.q })}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  textDecoration: "none",
                  border: "1px solid var(--border)",
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "var(--accent-ink)" : "var(--muted)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {TASK_VIEW_LABELS[v]} ({counts[v]})
              </Link>
            );
          })}
        </nav>
        <SearchForm q={params.q} placeholder="Search by title…" hidden={{ view }} />
      </div>

      <SavedViewsBar listKey="tasks" current={{ view, q: params.q }} />

      {pageTasks.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          {params.q ? `No tasks match “${params.q}” in this view.` : "No tasks in this view."}
        </p>
      ) : (
        <BulkProvider allIds={pageTasks.map((t) => t.id)}>
          <div style={{ display: "grid", gap: 12 }}>
            {pageTasks.map((task) => (
              <div key={task.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <BulkCheckbox id={task.id} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TaskCard
                    task={task}
                    ownerEmail={task.ownerUserId ? emailById.get(task.ownerUserId) ?? null : null}
                    members={members}
                    today={today}
                  />
                </div>
              </div>
            ))}
          </div>
          <BulkBar>
            <BulkActionForm
              action={bulkUpdateTasks}
              field="ownerUserId"
              options={members.map((m) => ({ value: m.id, label: m.email }))}
              submitLabel="Set owner"
            />
            <BulkActionForm
              action={bulkUpdateTasks}
              field="status"
              options={[
                { value: "open", label: "Open" },
                { value: "in_progress", label: "In progress" },
                { value: "blocked", label: "Blocked" },
              ]}
              submitLabel="Set status"
            />
            <BulkActionForm
              action={bulkUpdateTasks}
              field="priority"
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "critical", label: "Critical" },
              ]}
              submitLabel="Set priority"
            />
            <BulkActionForm action={bulkUpdateTasks} hidden={{ complete: "1" }} submitLabel="Complete" />
          </BulkBar>
        </BulkProvider>
      )}

      <Pagination
        page={params.page}
        totalPages={totalPages}
        total={total}
        prevHref={listHref("/tasks", { view, q: params.q, page: params.page - 1 })}
        nextHref={listHref("/tasks", { view, q: params.q, page: params.page + 1 })}
      />
    </PageShell>
  );
}

function TaskCard({
  task,
  ownerEmail,
  members,
  today,
}: {
  task: typeof tasks.$inferSelect;
  ownerEmail: string | null;
  members: ReadonlyArray<{ id: string; email: string }>;
  today: string;
}): ReactNode {
  const overdue =
    task.status !== "done" && task.dueDate !== null && task.dueDate < today;
  const statusForSelect =
    task.status === "done" ? "open" : task.status;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
        <strong style={{ fontSize: 15 }}>{task.title}</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", justifyContent: "end" }}>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {SOURCE_LABELS[task.source] ?? task.source}
          </span>
          <Badge tone={statusTone(task.priority)}>{task.priority}</Badge>
          {task.status === "done" && <Badge tone={statusTone("done")}>done</Badge>}
          {overdue && <Badge tone={statusTone("overdue")}>overdue</Badge>}
        </div>
      </div>
      {task.description && (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 10px" }}>
          {task.description}
        </p>
      )}
      <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 10px" }}>
        Owner: {ownerEmail ?? "Unassigned"}
        {task.dueDate ? ` · Due ${task.dueDate}` : ""}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <FormDrawer
          triggerLabel="Edit"
          triggerVariant="secondary"
          title="Edit task"
          action={updateTask}
          submitLabel="Save changes"
          successMessage="Task updated."
          submitVariant="secondary"
          hidden={{ taskId: task.id }}
        >
          <label style={labelStyle}>
            <span style={spanStyle}>Status</span>
            <select name="status" defaultValue={statusForSelect} style={controlStyle}>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>Priority</span>
            <select name="priority" defaultValue={task.priority} style={controlStyle}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>Owner</span>
            <select
              name="ownerUserId"
              defaultValue={task.ownerUserId ?? ""}
              style={controlStyle}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.email}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            <span style={spanStyle}>Due date</span>
            <input
              name="dueDate"
              type="date"
              defaultValue={task.dueDate ?? ""}
              style={controlStyle}
            />
          </label>
        </FormDrawer>

        {task.status !== "done" && (
          <MutationForm
            action={completeTask}
            submitLabel="Complete"
            variant="secondary"
            hidden={{ taskId: task.id }}
          />
        )}
      </div>
    </Card>
  );
}
