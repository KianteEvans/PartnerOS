import { and, desc, eq, isNull, or } from "drizzle-orm";
import { withTenant, type DbIdentity } from "@/db/client";
import { playbooks, playbookRuns, notifications, notificationWebhooks, workspaceSettings, users } from "@/db/schema";
import type { AutomationMode } from "@/domain/settings/automation";

/** RLS-scoped read loaders for the playbook engine + persisted notifications. */

export type PlaybookRow = typeof playbooks.$inferSelect;
export type PlaybookRunRow = typeof playbookRuns.$inferSelect & { readonly playbookName: string };
export type NotificationRow = typeof notifications.$inferSelect;
export type WebhookRow = typeof notificationWebhooks.$inferSelect;

export async function loadPlaybooks(identity: DbIdentity): Promise<PlaybookRow[]> {
  return withTenant(identity, (tx) =>
    tx.select().from(playbooks).where(eq(playbooks.tenantId, identity.tenantId)).orderBy(desc(playbooks.createdAt)),
  );
}

export async function loadRuns(identity: DbIdentity, limit = 100): Promise<PlaybookRunRow[]> {
  return withTenant(identity, async (tx) => {
    const rows = await tx
      .select({ run: playbookRuns, name: playbooks.name })
      .from(playbookRuns)
      .innerJoin(playbooks, eq(playbookRuns.playbookId, playbooks.id))
      .where(eq(playbookRuns.tenantId, identity.tenantId))
      .orderBy(desc(playbookRuns.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r.run, playbookName: r.name }));
  });
}

/** The current user's inbox: notifications addressed to them or the whole workspace. */
export async function loadInbox(identity: DbIdentity, limit = 50): Promise<{ items: NotificationRow[]; unread: number }> {
  return withTenant(identity, async (tx) => {
    const items = await tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, identity.tenantId),
          or(eq(notifications.userId, identity.userId), isNull(notifications.userId)),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    const unread = items.filter((n) => n.readAt === null).length;
    return { items, unread };
  });
}

export async function loadWebhooks(identity: DbIdentity): Promise<WebhookRow[]> {
  return withTenant(identity, (tx) =>
    tx
      .select()
      .from(notificationWebhooks)
      .where(eq(notificationWebhooks.tenantId, identity.tenantId))
      .orderBy(desc(notificationWebhooks.createdAt)),
  );
}

/** Workspace members, for owner-selection in the playbook builder. */
export async function loadMembers(identity: DbIdentity): Promise<{ id: string; email: string }[]> {
  return withTenant(identity, (tx) =>
    tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.tenantId, identity.tenantId)),
  );
}

/** The tenant's automation mode (default recommend_only) — governs playbook verdicts. */
export async function loadAutomationMode(identity: DbIdentity): Promise<AutomationMode> {
  const rows = await withTenant(identity, (tx) =>
    tx
      .select({ mode: workspaceSettings.automationMode })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.tenantId, identity.tenantId))
      .limit(1),
  );
  return (rows[0]?.mode as AutomationMode | undefined) ?? "recommend_only";
}
