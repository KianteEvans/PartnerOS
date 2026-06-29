"use server";

import { parseOrThrow, type ActionState } from "@/domain/forms";
import { AppError } from "@/http/errors";
import { demoRequestSchema } from "@/domain/demo/schemas";
import { createDemoRequestOp } from "@/domain/demo/operations";

/**
 * Public "Book a demo" submission. Deliberately does NOT go through the mutation
 * gate (there is no authenticated identity to authorize/audit) — it validates the
 * payload and writes a vendor-level lead via the system path. A hidden honeypot
 * field ("companyUrl") catches the simplest bots: humans never see it, so if it
 * is filled we drop the request silently while still reporting success.
 */
export async function submitDemoRequest(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const honeypot = formData.get("companyUrl");
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return { ok: true };
  }
  try {
    const input = parseOrThrow(demoRequestSchema, {
      name: formData.get("name"),
      email: formData.get("email"),
      company: formData.get("company"),
      teamSize: formData.get("teamSize"),
      message: formData.get("message"),
    });
    await createDemoRequestOp(input);
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) {
      return {
        ok: false,
        error: err.expose ? err.message : "Something went wrong. Please try again.",
      };
    }
    throw err;
  }
}
