"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { IDLE_STATE } from "@/domain/forms";
import { deleteSavedView } from "@/domain/views/actions";
import { emitToast } from "@/components/ui/toast";

/**
 * Compact "remove saved view" control — a bare ✕ that fits inside a view chip.
 * Its own tiny client island (rather than a full MutationForm) so the chip stays
 * pill-sized; success refreshes the list via the action's revalidatePath.
 */
export function RemoveViewButton({
  id,
  listKey,
}: {
  id: string;
  listKey: string;
}): ReactNode {
  const [state, formAction, pending] = useActionState(deleteSavedView, IDLE_STATE);

  useEffect(() => {
    if (state.error) emitToast(state.error, "danger");
  }, [state]);

  return (
    <form action={formAction} style={{ display: "inline-flex" }}>
      <input type="hidden" name="viewId" value={id} />
      <input type="hidden" name="listKey" value={listKey} />
      <button
        type="submit"
        disabled={pending}
        aria-label="Delete saved view"
        title="Delete saved view"
        style={{
          border: "none",
          background: "transparent",
          color: "var(--muted)",
          cursor: pending ? "default" : "pointer",
          fontSize: 13,
          lineHeight: 1,
          padding: "0 6px",
          opacity: pending ? 0.5 : 1,
        }}
      >
        ✕
      </button>
    </form>
  );
}
