import { NextResponse } from "next/server";
import { getServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { withTenant } from "@/db/client";
import { auditLog } from "@/db/schema";
import { rotateScimTokenWithinTx, setScimEnabledWithinTx } from "@/domain/sso/operations";

/**
 * SCIM admin actions (settings:manage). Deliberately NOT through the mutation
 * gate: the gate persists the handler's response in the idempotency ledger, and
 * the rotated token is a secret that must never be stored — so this returns it
 * out-of-band and writes its own audit row inside the same tenant transaction.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const identity = await getServerIdentity().catch(() => null);
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(identity.role, "settings:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let action = "";
  try {
    const body: unknown = await req.json();
    if (body !== null && typeof body === "object" && typeof (body as { action?: unknown }).action === "string") {
      action = (body as { action: string }).action;
    }
  } catch {
    /* empty/invalid body falls through to the unknown-action error */
  }

  if (action === "rotate") {
    const { token } = await withTenant(identity, async (tx) => {
      const result = await rotateScimTokenWithinTx(tx, identity.tenantId);
      await tx.insert(auditLog).values({
        tenantId: identity.tenantId,
        actorUserId: identity.userId,
        action: "scim.token_rotate",
        resourceType: "sso_config",
        resourceId: identity.tenantId,
        metadata: {},
      });
      return result;
    });
    return NextResponse.json({ ok: true, token });
  }

  if (action === "disable") {
    await withTenant(identity, async (tx) => {
      await setScimEnabledWithinTx(tx, identity.tenantId, false);
      await tx.insert(auditLog).values({
        tenantId: identity.tenantId,
        actorUserId: identity.userId,
        action: "scim.disable",
        resourceType: "sso_config",
        resourceId: identity.tenantId,
        metadata: {},
      });
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
