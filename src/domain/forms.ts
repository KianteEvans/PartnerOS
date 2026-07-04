import { z } from "zod";
import { ValidationError } from "@/http/errors";

/**
 * Shared form/action plumbing used by every domain's server actions and the
 * MutationForm client island. Domain-specific Zod payload schemas live with
 * their feature; these are the generic pieces.
 */

/** The shape every domain server action returns for useActionState. */
export interface ActionState {
  readonly ok: boolean;
  readonly error?: string;
  /** Optional success detail; overrides the form's static successMessage toast when set. */
  readonly detail?: string;
}

export const IDLE_STATE: ActionState = { ok: false };

/** Parse with a Zod schema or throw a ValidationError carrying the first issue. */
export function parseOrThrow<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  data: unknown,
): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ValidationError(first ? first.message : "Invalid request");
  }
  return parsed.data;
}
