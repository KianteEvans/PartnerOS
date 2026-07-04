"use client";

import {
  useActionState,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { IDLE_STATE, type ActionState } from "@/domain/forms";
import { emitToast } from "@/components/ui/toast";
import { useBulk } from "@/components/ui/bulk/BulkProvider";

const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "5px 8px",
  color: "var(--text)",
  fontSize: 13,
} as const;

/**
 * One control in the bulk bar: an optional `<select>` plus a submit button that
 * applies the choice to the currently selected rows. The selected ids ride along
 * in a hidden field; a rotated idempotency token dedupes a double-click but lets
 * a fresh apply be a new operation. On success it toasts and clears the
 * selection (which collapses the bar).
 */
export function BulkActionForm({
  action,
  field,
  options,
  hidden,
  submitLabel,
  variant = "secondary",
  successMessage = "Updated.",
  confirmMessage,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** Name of the `<select>` field; omit for a button-only action. */
  field?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Extra fixed fields, e.g. `{ complete: "1" }`. */
  hidden?: Readonly<Record<string, string>>;
  submitLabel: string;
  variant?: "primary" | "secondary" | "danger";
  successMessage?: string;
  /** When set, a native confirm() must be accepted before the form submits. */
  confirmMessage?: string;
}): ReactNode {
  const { selected, clear } = useBulk();
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  const [token, setToken] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (state.ok) {
      setToken(crypto.randomUUID());
      emitToast(successMessage, "ok");
      clear();
    } else if (state.error) {
      emitToast(state.error, "danger");
    }
  }, [state, successMessage, clear]);

  const v =
    variant === "primary"
      ? { background: "var(--accent)", color: "var(--accent-ink)", border: "1px solid var(--accent)" }
      : variant === "danger"
        ? {
            background: "color-mix(in srgb, var(--danger) 12%, transparent)",
            color: "var(--danger)",
            border: "1px solid color-mix(in srgb, var(--danger) 45%, transparent)",
          }
        : { background: "transparent", color: "var(--text)", border: "1px solid var(--border)" };

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
      style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
    >
      <input type="hidden" name="ids" value={JSON.stringify([...selected])} />
      <input type="hidden" name="idempotencyKey" value={token} />
      {hidden &&
        Object.entries(hidden).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
      {field && options && (
        <select name={field} defaultValue="" required style={controlStyle}>
          <option value="" disabled>
            {submitLabel}…
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <button
        type="submit"
        disabled={pending}
        style={{
          ...v,
          borderRadius: 8,
          padding: "5px 12px",
          fontWeight: 600,
          fontSize: 13,
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {pending ? "Working…" : field ? "Apply" : submitLabel}
      </button>
    </form>
  );
}
