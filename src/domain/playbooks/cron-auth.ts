import { createHash, timingSafeEqual } from "crypto";
import { env } from "@/env";

/**
 * Bearer auth for the scheduled playbook runner (/api/cron/run-playbooks). Mirrors
 * the SCIM token pattern: compare a SHA-256 digest in constant time. The endpoint
 * is DISABLED unless PLAYBOOK_RUNNER_TOKEN is configured — no token, no access.
 */
export function authRunnerToken(req: Request): boolean {
  const configured = env.PLAYBOOK_RUNNER_TOKEN ?? "";
  if (!configured) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return false;
  const a = createHash("sha256").update(m[1]!.trim()).digest();
  const b = createHash("sha256").update(configured).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}
