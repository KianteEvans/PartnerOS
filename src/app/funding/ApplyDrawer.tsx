import type { CSSProperties, ReactNode } from "react";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { createFundingSubmission } from "@/domain/funding/actions";
import { FUNDING_PROGRAMS, WORKLOAD_LABELS, SEGMENT_LABELS, type FundingProgram } from "@/domain/funding/catalog";

/**
 * "Apply for funding" drawer — creates a draft funding submission. When a `program`
 * is given the program is fixed (from a catalog card / matcher row); otherwise the
 * user picks one. An optional `oppId` attributes the submission to an ACE deal.
 */

const control: CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "inherit",
};
const label: CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
const span: CSSProperties = { fontWeight: 600, color: "var(--muted)" };
const row: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" };

export function ApplyDrawer({
  program,
  oppId,
  triggerLabel,
  triggerVariant = "primary",
}: {
  program?: FundingProgram;
  oppId?: string;
  triggerLabel?: string;
  triggerVariant?: "primary" | "secondary" | "danger";
}): ReactNode {
  const hidden: Record<string, string> = {};
  if (program) hidden.programKey = program.key;
  if (oppId) hidden.opportunityId = oppId;
  const defaultFundingType = program?.fundingType === "credits" ? "credits" : "cash";

  return (
    <FormDrawer
      triggerLabel={triggerLabel ?? "Apply"}
      triggerVariant={triggerVariant}
      title={program ? `Apply — ${program.name}` : "New funding submission"}
      action={createFundingSubmission}
      submitLabel="Create draft"
      successMessage="Draft submission created."
      hidden={hidden}
    >
      {!program && (
        <label style={label}>
          <span style={span}>Program</span>
          <select name="programKey" required style={control} defaultValue="">
            <option value="" disabled>
              Choose a program…
            </option>
            {FUNDING_PROGRAMS.filter((p) => !p.managedInternally).map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label style={label}>
        <span style={span}>Title</span>
        <input name="title" required maxLength={200} defaultValue={program ? `${program.name} — funding request` : ""} style={control} />
      </label>
      <div style={row}>
        <label style={{ ...label, flex: 1, minWidth: 140 }}>
          <span style={span}>Funding type</span>
          <select name="fundingType" defaultValue={defaultFundingType} style={control}>
            <option value="cash">Cash</option>
            <option value="credits">AWS credits</option>
          </select>
        </label>
        <label style={{ ...label, flex: 1, minWidth: 140 }}>
          <span style={span}>Requested amount (USD)</span>
          <input name="requestedAmount" type="number" min={0} defaultValue={0} style={control} />
        </label>
      </div>
      <div style={row}>
        <label style={{ ...label, flex: 1, minWidth: 140 }}>
          <span style={span}>Workload</span>
          <select name="workloadType" defaultValue="" style={control}>
            <option value="">—</option>
            {Object.entries(WORKLOAD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...label, flex: 1, minWidth: 140 }}>
          <span style={span}>Customer segment</span>
          <select name="customerSegment" defaultValue="" style={control}>
            <option value="">—</option>
            {Object.entries(SEGMENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label style={label}>
        <span style={span}>Response deadline (optional)</span>
        <input name="deadline" type="date" style={control} />
      </label>
      <label style={label}>
        <span style={span}>AWS reference (optional)</span>
        <input name="externalRef" maxLength={200} placeholder="Partner Funding Portal / SPMS id" style={control} />
      </label>
    </FormDrawer>
  );
}
