"use client";

import type { ReactNode } from "react";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { createApplication } from "@/domain/applications/actions";

const labelStyle = { display: "grid", gap: 4, fontSize: 12 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 8px",
  color: "var(--text)",
  fontSize: 13,
} as const;

/** Upload an AWS Competency Self-Assessment .xlsx -> parse + persist the controls. */
export function UploadApplication(): ReactNode {
  return (
    <FormDrawer
      triggerLabel="Upload workbook"
      title="Upload an AWS Specialization Self-Assessment"
      action={createApplication}
      submitLabel="Upload & parse"
      successMessage="Workbook uploaded."
    >
      <label style={labelStyle}>
        <span style={spanStyle}>Workbook (.xlsx)</span>
        <input type="file" name="file" accept=".xlsx" required style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Name (optional)</span>
        <input name="name" maxLength={160} placeholder="e.g. Security Competency 2026" style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Specialization / program (optional)</span>
        <input name="competency" maxLength={120} placeholder="auto-detected from the file" style={controlStyle} />
      </label>
      <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
        We parse the controls; you can then draft each Partner Response from your Evidence Locker.
      </p>
    </FormDrawer>
  );
}
