import type { ReactNode } from "react";

/**
 * Minimal form primitive. Wraps a server action and lays out labeled fields.
 * Larger forms compose this rather than re-implementing layout (Rule 7).
 */
export function Form({
  action,
  submitLabel = "Save",
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  submitLabel?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <form action={action} style={{ display: "grid", gap: 12 }}>
      {children}
      <button
        type="submit"
        style={{
          justifySelf: "start",
          background: "var(--accent)",
          color: "var(--accent-ink)",
          border: "none",
          borderRadius: 8,
          padding: "8px 16px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {submitLabel}
      </button>
    </form>
  );
}

export function Field({
  label,
  name,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}): ReactNode {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "8px 10px",
          color: "var(--text)",
        }}
      />
    </label>
  );
}
