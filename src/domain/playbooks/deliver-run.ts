import { and, eq } from "drizzle-orm";
import { withTenant, type DbIdentity } from "@/db/client";
import { notifications, notificationWebhooks, users } from "@/db/schema";
import { sendEmail, sendWebhook } from "@/notifications/delivery";

/**
 * Flush a tenant's pending external deliveries. In-app notifications are persisted
 * at enqueue time; email/webhook are marked `pending` and dispatched here (by the
 * cron runner) so a slow relay never blocks the request that created them. Each
 * notification's channel status is advanced to sent/failed/none. RLS-scoped.
 */
export async function deliverPendingForTenant(identity: DbIdentity): Promise<{ emails: number; webhooks: number }> {
  return withTenant(identity, async (tx) => {
    let emails = 0;
    let webhooks = 0;

    // Email: send each pending notification to its recipient's address.
    const pendingEmail = await tx
      .select({ id: notifications.id, title: notifications.title, body: notifications.body, link: notifications.link, userId: notifications.userId })
      .from(notifications)
      .where(and(eq(notifications.tenantId, identity.tenantId), eq(notifications.emailStatus, "pending")));
    for (const n of pendingEmail) {
      let to = "";
      if (n.userId) {
        const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, n.userId));
        to = u?.email ?? "";
      }
      const result = to ? await sendEmail({ to, subject: n.title, body: `${n.body}\n\n${n.link}` }) : "skipped";
      const status = result === "sent" ? "sent" : result === "failed" ? "failed" : "none";
      await tx.update(notifications).set({ emailStatus: status }).where(eq(notifications.id, n.id));
      if (result === "sent") emails++;
    }

    // Webhook: POST each pending notification to every enabled target.
    const hooks = await tx
      .select()
      .from(notificationWebhooks)
      .where(and(eq(notificationWebhooks.tenantId, identity.tenantId), eq(notificationWebhooks.enabled, true)));
    const pendingHook = await tx
      .select({ id: notifications.id, title: notifications.title, body: notifications.body, link: notifications.link, severity: notifications.severity })
      .from(notifications)
      .where(and(eq(notifications.tenantId, identity.tenantId), eq(notifications.webhookStatus, "pending")));
    for (const n of pendingHook) {
      const payload = JSON.stringify({ type: "notification", severity: n.severity, title: n.title, detail: n.body, link: n.link });
      let anySent = false;
      let anyFailed = false;
      for (const h of hooks) {
        const r = await sendWebhook(h.url, payload, h.secret);
        if (r === "sent") anySent = true;
        else anyFailed = true;
      }
      const status = hooks.length === 0 ? "none" : anySent ? "sent" : anyFailed ? "failed" : "none";
      await tx.update(notifications).set({ webhookStatus: status }).where(eq(notifications.id, n.id));
      if (anySent) webhooks++;
    }

    return { emails, webhooks };
  });
}
