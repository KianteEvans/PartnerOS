"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MutationForm } from "@/components/ui/MutationForm";
import type { ActionState } from "@/domain/forms";

/**
 * Creation/edit behind a button → right-side drawer (data-first lists instead of
 * always-expanded inline forms). Wraps `MutationForm`; the drawer auto-closes on
 * a successful submit (the form's success toast still fires). Closes on Esc or
 * backdrop click. The trigger button is rendered inline wherever this is placed
 * (a page header for "New X", or a row for "Edit").
 */
export function FormDrawer({
  triggerLabel,
  triggerVariant = "primary",
  title,
  action,
  submitLabel = "Save",
  successMessage,
  hidden,
  submitVariant = "primary",
  width = 460,
  children,
}: {
  triggerLabel: string;
  triggerVariant?: "primary" | "secondary" | "danger";
  title: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
  successMessage?: string;
  hidden?: Readonly<Record<string, string>>;
  submitVariant?: "primary" | "secondary" | "danger";
  width?: number;
  children?: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const triggerStyle =
    triggerVariant === "primary"
      ? {
          background: "var(--accent)",
          color: "var(--accent-ink)",
          border: "1px solid var(--accent)",
        }
      : triggerVariant === "danger"
        ? {
            background: "color-mix(in srgb, var(--danger) 12%, transparent)",
            color: "var(--danger)",
            border: "1px solid color-mix(in srgb, var(--danger) 45%, transparent)",
          }
        : {
            background: "transparent",
            color: "var(--text)",
            border: "1px solid var(--border)",
          };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          ...triggerStyle,
          borderRadius: 8,
          padding: triggerVariant === "primary" ? "8px 16px" : "6px 12px",
          fontWeight: 600,
          fontSize: 13,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {triggerLabel}
      </button>

      {open && (
        <div
          onMouseDown={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1500,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={title}
            aria-modal="true"
            className="pos-drawer"
            style={{
              width: `min(${width}px, 94vw)`,
              height: "100%",
              background: "var(--panel)",
              borderLeft: "1px solid var(--border)",
              boxShadow: "var(--shadow-lift)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  fontSize: 20,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                ✕
              </button>
            </header>
            <div style={{ padding: 20, overflowY: "auto" }}>
              <MutationForm
                action={action}
                submitLabel={submitLabel}
                successMessage={successMessage}
                variant={submitVariant}
                hidden={hidden}
                onSuccess={() => setOpen(false)}
              >
                {children}
              </MutationForm>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
