"use client";

import { useState, type ReactNode } from "react";

/**
 * Client island: a slide-over drawer. Server components render the trigger and
 * content; only the open/close state lives on the client (Rule 7: small client
 * islands, server components for data).
 */
export function Drawer({
  trigger,
  title,
  children,
}: {
  trigger: ReactNode;
  title: string;
  children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span onClick={() => setOpen(true)} style={{ cursor: "pointer" }}>
        {trigger}
      </span>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            justifyContent: "flex-end",
            zIndex: 50,
          }}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 420,
              maxWidth: "90vw",
              height: "100%",
              background: "var(--panel)",
              borderLeft: "1px solid var(--border)",
              padding: 24,
              overflowY: "auto",
            }}
          >
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                  fontSize: 18,
                }}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            {children}
          </aside>
        </div>
      )}
    </>
  );
}
