"use client";

import { useEffect, useState, type ReactNode } from "react";
import { TOAST_EVENT, type ToastPayload, type ToastTone } from "@/components/ui/toast";

interface ActiveToast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

let counter = 0;

const toneColor = (tone: ToastTone): string =>
  tone === "danger" ? "var(--danger)" : tone === "info" ? "var(--info)" : "var(--ok)";

/**
 * Mounted once in the root layout. Listens for toast events and renders a
 * bottom-right stack; each toast auto-dismisses. Click to dismiss early.
 */
export function Toaster(): ReactNode {
  const [toasts, setToasts] = useState<ReadonlyArray<ActiveToast>>([]);

  useEffect(() => {
    function onToast(e: Event): void {
      const { message, tone } = (e as CustomEvent<ToastPayload>).detail;
      const id = ++counter;
      setToasts((cur) => [...cur, { id, message, tone }]);
      window.setTimeout(() => {
        setToasts((cur) => cur.filter((t) => t.id !== id));
      }, 3800);
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  const dismiss = (id: number): void =>
    setToasts((cur) => cur.filter((t) => t.id !== id));

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 1000,
        display: "grid",
        gap: 8,
        maxWidth: 360,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          className="pos-toast"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderLeft: `3px solid ${toneColor(t.tone)}`,
            borderRadius: 8,
            padding: "10px 14px",
            boxShadow: "var(--shadow)",
            fontSize: 13,
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: toneColor(t.tone),
              flexShrink: 0,
            }}
          />
          {t.message}
        </div>
      ))}
    </div>
  );
}
