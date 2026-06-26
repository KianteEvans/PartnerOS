"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError, ValidationError } from "@/http/errors";
import { type ActionState } from "@/domain/forms";
import { saveSamlConfigOp } from "@/domain/sso/operations";

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

function field(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function saveSamlConfig(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const enabled = formData.get("samlEnabled") === "on" || formData.get("samlEnabled") === "true";
    const idpEntityId = field(formData.get("idpEntityId"));
    const idpSsoUrl = field(formData.get("idpSsoUrl"));
    const idpCert = field(formData.get("idpCert"));
    if (idpSsoUrl && !/^https?:\/\//i.test(idpSsoUrl)) {
      throw new ValidationError("The IdP SSO URL must start with http(s)://");
    }
    await runMutation({
      permission: "settings:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      // The cert is public; keep it out of the hashed body (it can be large).
      rawBody: JSON.stringify({ enabled, idpEntityId, idpSsoUrl, certLen: idpCert.length }),
      action: "settings.save_saml",
      resourceType: "sso_config",
      auditMetadata: { enabled },
      handler: (ctx) =>
        saveSamlConfigOp(ctx, {
          enabled,
          idpEntityId: idpEntityId || null,
          idpSsoUrl: idpSsoUrl || null,
          idpCert: idpCert || null,
        }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}
