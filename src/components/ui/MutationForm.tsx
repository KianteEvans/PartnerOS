"use client";

import {
  useActionState,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { IDLE_STATE, type ActionState } from "@/domain/forms";
import { emitToast } from "@/components/ui/toast";

/**
 * Shared client island that drives any domain server action through the
 * mutation gate (Rule 7). The base `Form` primitive has no error slot and no
 * idempotency story; this adds both:
 *
 *   - a per-form idempotency token (hidden field) that ROTATES after a
 *     successful submit, so a true retry (no success yet) replays/dedupes via
 *     the gate, while a fresh edit is a new operation;
 *   - an error message surfaced from the typed AppError the action returns.
 *
 * Server components pass the bound action and render the fields as children.
 */
export function MutationForm({
  action,
  submitLabel = "Save",
  successMessage = "Saved.",
  variant = "primary",
  hidden,
  onSuccess,
  children,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
  // `| undefined` (not just `?`) so callers forwarding an optional value —
  // e.g. FormDrawer passing its own optional props through — type-check under
  // exactOptionalPropertyTypes.
  successMessage?: string | undefined;
  variant?: "primary" | "secondary" | "danger";
  hidden?: Readonly<Record<string, string>> | undefined;
  /** Called after a successful submit — e.g. to close a drawer/modal. */
  onSuccess?: () => void;
  children?: ReactNode;
}): ReactNode {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  const [token, setToken] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (state.ok) {
      setToken(crypto.randomUUID());
      emitToast(successMessage, "ok");
      onSuccess?.();
    } else if (state.error) {
      emitToast(state.error, "danger");
    }
    // Re-runs on each state change; onSuccess/successMessage are stable enough
    // that we key only on `state`.
  }, [state, successMessage]);

  const v =
    variant === "primary"
      ? {
          background: "var(--accent)",
          color: "var(--accent-ink)",
          border: "1px solid var(--accent)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
        }
      : variant === "danger"
        ? {
            background: "color-mix(in srgb, var(--danger) 12%, transparent)",
            color: "var(--danger)",
            border: "1px solid color-mix(in srgb, var(--danger) 45%, transparent)",
            boxShadow: "none",
          }
        : {
            background: "transparent",
            color: "var(--text)",
            border: "1px solid var(--border)",
            boxShadow: "none",
          };

  return (
    <form action={formAction} style={{ display: "grid", gap: 12 }}>
      {hidden &&
        Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <input type="hidden" name="idempotencyKey" value={token} />
      {children}
      {state.error && (
        <p role="alert" style={{ color: "var(--danger)", margin: 0, fontSize: 13 }}>
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        style={{
          justifySelf: "start",
          ...v,
          borderRadius: 8,
          padding: "8px 16px",
          fontWeight: 600,
          fontSize: 13,
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "Working…" : submitLabel}
      </button>
    </form>
  );
}
