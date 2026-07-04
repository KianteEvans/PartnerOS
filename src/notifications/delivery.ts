import { createHmac } from "crypto";
import { env } from "@/env";

/**
 * Outbound delivery adapter for playbook notifications. Email goes through a relay
 * URL (a dev stub locally, an SES/HTTP relay in prod); when unconfigured it is a
 * graceful no-op (like the ANTHROPIC_API_KEY gating). Webhooks POST signed JSON.
 * No vendor SDK — a plain fetch keeps this swappable and dependency-free.
 */

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export type DeliveryResult = "sent" | "skipped" | "failed";

export async function sendEmail(msg: EmailMessage): Promise<DeliveryResult> {
  const url = env.EMAIL_DELIVERY_URL ?? "";
  if (!url) return "skipped";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(msg),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/** POST a JSON body to a webhook, signed with HMAC-SHA256 when a secret is set. */
export async function sendWebhook(url: string, body: string, secret: string): Promise<DeliveryResult> {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (secret) headers["x-partneros-signature"] = createHmac("sha256", secret).update(body).digest("hex");
    const res = await fetch(url, { method: "POST", headers, body });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
