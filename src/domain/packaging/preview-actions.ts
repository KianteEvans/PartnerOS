"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { tryGetServerIdentity } from "@/auth/session";
import { can } from "@/authz/permissions";
import { env } from "@/env";
import { withTenant } from "@/db/client";
import { auditLog } from "@/db/schema";
import type { ActionState } from "@/domain/forms";
import { PACKAGE_META, PACKAGE_TIERS } from "@/domain/packaging/catalog";
import { PREVIEW_COOKIE, PREVIEW_MAX_AGE_SECONDS } from "@/domain/packaging/preview";

/**
 * Set/clear the per-user package preview. Cookie-only (no DB state) — this is
 * a presentation simulation, not an entitlement — so it bypasses the mutation
 * gate but keeps the same guard rails: permission check, allowlist validation,
 * and a best-effort audit row so demos leave a trace.
 */

const inputSchema = z.object({ tier: z.enum(["off", ...PACKAGE_TIERS]) });

type Identity = NonNullable<Awaited<ReturnType<typeof tryGetServerIdentity>>>;

// Best-effort trace — the preview is cookie-only, but demos should leave a mark.
async function audit(identity: Identity, tier: string): Promise<void> {
  await withTenant(identity, (tx) =>
    tx.insert(auditLog).values({
      tenantId: identity.tenantId,
      actorUserId: identity.userId,
      action: "settings.package_preview",
      resourceType: "workspace_settings",
      metadata: { tier },
    }),
  ).catch(() => undefined);
}

export async function setPackagePreview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identity = await tryGetServerIdentity();
  if (!identity) return { ok: false, error: "Sign in to change the preview." };
  if (!can(identity.role, "settings:manage")) {
    return { ok: false, error: "Only owners and admins can preview packages." };
  }
  const parsed = inputSchema.safeParse({ tier: formData.get("tier") });
  if (!parsed.success) return { ok: false, error: "Pick a package to preview." };

  const jar = await cookies();
  if (parsed.data.tier === "off") {
    jar.delete(PREVIEW_COOKIE);
  } else {
    jar.set(PREVIEW_COOKIE, parsed.data.tier, {
      httpOnly: true,
      secure: !env.IS_LOCAL_DEV,
      sameSite: "lax",
      path: "/",
      maxAge: PREVIEW_MAX_AGE_SECONDS,
    });
  }
  await audit(identity, parsed.data.tier);
  revalidatePath("/", "layout");
  return {
    ok: true,
    detail:
      parsed.data.tier === "off"
        ? "Package preview off — full platform."
        : `Previewing as ${PACKAGE_META[parsed.data.tier].label}. Only you see this; it expires in 8 hours.`,
  };
}

/** Banner exit: plain form action (progressively enhanced, works without JS). */
export async function clearPackagePreview(): Promise<void> {
  const identity = await tryGetServerIdentity();
  if (!identity) return;
  const jar = await cookies();
  jar.delete(PREVIEW_COOKIE);
  await audit(identity, "off");
  revalidatePath("/", "layout");
}
